import { Type } from "@sinclair/typebox";
import {
  publicKey,
  transactionBuilder,
} from "@metaplex-foundation/umi";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import {
  finalizeV2,
  fetchGenesisAccountV2,
  findLaunchPoolBucketV2Pda,
  findUnlockedBucketV2Pda,
  findRaydiumCpmmBucketV2Pda,
} from "@metaplex-foundation/genesis";
import { getUmi, type UmiConfig } from "../umi.js";

export const FinalizeLaunchSchema = Type.Object({
  genesisAccount: Type.String({
    description: "Genesis account address (from genesis_create_launch result)",
  }),
  launchpoolBucketIndexes: Type.Optional(
    Type.Array(Type.Number(), {
      description:
        "Bucket indexes of LaunchPool buckets that were added. Defaults to [0] if you added one launchpool.",
    })
  ),
  unlockedBucketIndexes: Type.Optional(
    Type.Array(Type.Number(), {
      description:
        "Bucket indexes of Unlocked buckets that were added. Defaults to [0] if you added one unlocked bucket.",
    })
  ),
  raydiumBucketIndexes: Type.Optional(
    Type.Array(Type.Number(), {
      description:
        "Bucket indexes of Raydium CPMM buckets that were added. Defaults to [0] if you added one Raydium bucket.",
    })
  ),
});

export function createFinalizeLaunchTool(pluginConfig?: UmiConfig) {
  return {
    name: "genesis_finalize_launch",
    label: "Genesis: Finalize Launch",
    description:
      "Finalize a Genesis launch after all buckets have been configured. This locks the launch " +
      "configuration and enables the launch to go live. Cannot be undone. " +
      "You must provide the bucket indexes for all buckets you added. " +
      "The total token allocation across all buckets must equal 100% of the total supply.",
    parameters: FinalizeLaunchSchema,
    async execute(
      _toolCallId: string,
      params: {
        genesisAccount: string;
        launchpoolBucketIndexes?: number[];
        unlockedBucketIndexes?: number[];
        raydiumBucketIndexes?: number[];
      }
    ) {
      try {
        const umi = getUmi(pluginConfig);
        const genesisAccountPk = publicKey(params.genesisAccount);

        // Fetch genesis account
        const genesisData = await fetchGenesisAccountV2(umi, genesisAccountPk);
        const baseMint = genesisData.baseMint;

        // Derive all bucket PDAs as remaining accounts
        const remainingAccounts: {
          pubkey: typeof genesisAccountPk;
          isSigner: boolean;
          isWritable: boolean;
        }[] = [];

        // IMPORTANT: Remaining account order matters for Genesis finalize.
        // Empirically, the program expects Raydium buckets first, then LaunchPool, then Unlocked.
        // (If ordered incorrectly, finalize can fail with confusing errors like
        // "LaunchPool bucket is missing a required graduation behavior".)

        // Add raydium buckets
        for (const idx of params.raydiumBucketIndexes ?? []) {
          const [bucketPk] = findRaydiumCpmmBucketV2Pda(umi, {
            genesisAccount: genesisAccountPk,
            bucketIndex: idx,
          });
          remainingAccounts.push({
            pubkey: bucketPk,
            isSigner: false,
            isWritable: false,
          });
        }

        // Add launchpool buckets
        for (const idx of params.launchpoolBucketIndexes ?? []) {
          const [bucketPk] = findLaunchPoolBucketV2Pda(umi, {
            genesisAccount: genesisAccountPk,
            bucketIndex: idx,
          });
          remainingAccounts.push({
            pubkey: bucketPk,
            isSigner: false,
            isWritable: false,
          });
        }

        // Add unlocked buckets
        for (const idx of params.unlockedBucketIndexes ?? []) {
          const [bucketPk] = findUnlockedBucketV2Pda(umi, {
            genesisAccount: genesisAccountPk,
            bucketIndex: idx,
          });
          remainingAccounts.push({
            pubkey: bucketPk,
            isSigner: false,
            isWritable: false,
          });
        }

        // Validate bucket count matches
        if (remainingAccounts.length !== genesisData.bucketCount) {
          throw new Error(
            `Bucket count mismatch: provided ${remainingAccounts.length} bucket indexes ` +
              `but genesis account has ${genesisData.bucketCount} buckets. ` +
              `Make sure you list all bucket indexes that were added.`
          );
        }

        // Validate total allocation
        const totalAllocated = genesisData.totalAllocatedSupplyBaseToken;
        const totalSupply = genesisData.totalSupplyBaseToken;
        if (totalAllocated !== totalSupply) {
          throw new Error(
            `Token allocation mismatch: ${totalAllocated} allocated out of ${totalSupply} total supply. ` +
              `Bucket allocations must sum to 100% of total supply.`
          );
        }

        // Finalize
        await transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 400_000 }))
          .add(
            finalizeV2(umi, {
              genesisAccount: genesisAccountPk,
              baseMint,
            }).addRemainingAccounts(remainingAccounts)
          )
          .sendAndConfirm(umi);

        const result = {
          status: "success",
          genesisAccount: params.genesisAccount,
          finalized: true,
          bucketCount: remainingAccounts.length,
          totalSupply: totalSupply.toString(),
          message:
            "Launch finalized successfully. The launch is now live and configuration is locked.",
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          details: result,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "error",
                  error: err instanceof Error ? err.message : String(err),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    },
  };
}
