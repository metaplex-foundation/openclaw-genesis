import { Type } from "@sinclair/typebox";
import {
  publicKey,
  transactionBuilder,
} from "@metaplex-foundation/umi";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import { findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";
import {
  addRaydiumCpmmBucketV2Base,
  findRaydiumCpmmBucketV2Pda,
  findRaydiumBucketSignerPda,
  fetchGenesisAccountV2,
  WRAPPED_SOL_MINT,
  findLaunchPoolBucketV2Pda,
  safeFetchLaunchPoolBucketV2,
} from "@metaplex-foundation/genesis";
import { getUmi, getNetwork, type UmiConfig } from "../umi.js";
import {
  timeCondition,
  parseTime,
  percentToAmount,
  DEFAULT_POOL_CREATION_FEE,
  PADDING_6,
} from "../helpers/defaults.js";

export const AddRaydiumPoolSchema = Type.Object({
  genesisAccount: Type.String({
    description: "Genesis account address (from genesis_create_launch result)",
  }),
  tokenAllocationPercent: Type.Number({
    description:
      "Percentage of total supply allocated to Raydium liquidity (e.g. 20 for 20%)",
    minimum: 1,
    maximum: 100,
  }),
  startTime: Type.Optional(
    Type.String({
      description:
        'When the Raydium pool can be created. "now", an ISO date, or Unix timestamp. ' +
        "Typically set to after the LaunchPool deposit period ends. Defaults to \"now\".",
    })
  ),
  /**
   * Convenience: derive Raydium startTime from an existing LaunchPool bucket.
   * This avoids clock drift when callers use depositStartTime="now".
   */
  startTimeFromLaunchpoolBucketIndex: Type.Optional(
    Type.Number({
      description:
        "If provided and startTime is omitted, derive startTime from the specified LaunchPool bucket's deposit end time.",
      minimum: 0,
    })
  ),
  startTimeOffsetSeconds: Type.Optional(
    Type.Number({
      description:
        "Optional offset (in seconds) added to the derived LaunchPool deposit end time. Defaults to 60 seconds.",
      minimum: 0,
    })
  ),
  bucketIndex: Type.Optional(
    Type.Number({
      description:
        "Bucket index. Defaults to 0. Set this value and reference it in the launchpool's sendQuoteTokenToRaydiumBucketIndex.",
    })
  ),
});

export function createAddRaydiumPoolTool(pluginConfig?: UmiConfig) {
  return {
    name: "genesis_add_raydium_pool",
    label: "Genesis: Add Raydium Pool",
    description:
      "Add a Raydium CPMM graduation bucket to a Genesis launch. This creates a Raydium liquidity pool " +
      "with the allocated tokens and SOL received from the LaunchPool's end behavior. " +
      "Must be called after genesis_create_launch and before genesis_finalize_launch. " +
      "The launchpool's sendQuoteTokenToRaydiumBucketIndex should reference this bucket's index.",
    parameters: AddRaydiumPoolSchema,
    async execute(
      _toolCallId: string,
      params: {
        genesisAccount: string;
        tokenAllocationPercent: number;
        startTime?: string;
        startTimeFromLaunchpoolBucketIndex?: number;
        startTimeOffsetSeconds?: number;
        bucketIndex?: number;
      }
    ) {
      try {
        const umi = getUmi(pluginConfig);
        const network = getNetwork(pluginConfig);
        const genesisAccountPk = publicKey(params.genesisAccount);
        const bucketIndex = params.bucketIndex ?? 0;

        // Fetch genesis account
        const genesisData = await fetchGenesisAccountV2(umi, genesisAccountPk);
        const totalSupply = genesisData.totalSupplyBaseToken;
        const baseMint = genesisData.baseMint;

        // Calculate allocation
        const baseTokenAllocation = percentToAmount(
          params.tokenAllocationPercent,
          totalSupply
        );

        // Derive bucket PDAs
        const [bucket] = findRaydiumCpmmBucketV2Pda(umi, {
          genesisAccount: genesisAccountPk,
          bucketIndex,
        });
        const [bucketSigner] = findRaydiumBucketSignerPda(umi, {
          bucket,
        });

        // Derive token accounts for bucket signer
        const bucketSignerBaseTokenAccount = findAssociatedTokenPda(umi, {
          mint: baseMint,
          owner: bucketSigner,
        });
        const bucketSignerQuoteTokenAccount = findAssociatedTokenPda(umi, {
          mint: WRAPPED_SOL_MINT,
          owner: bucketSigner,
        });

        let startTimeInput: string | number = params.startTime ?? "now";

        // If caller omitted startTime but provided a LaunchPool bucket index, derive start time
        // from the LaunchPool deposit end time (+ optional offset). This avoids subtle drift
        // when depositStartTime is "now".
        if (params.startTime == null && params.startTimeFromLaunchpoolBucketIndex != null) {
          const [lpBucket] = findLaunchPoolBucketV2Pda(umi, {
            genesisAccount: genesisAccountPk,
            bucketIndex: params.startTimeFromLaunchpoolBucketIndex,
          });
          const lpData = await safeFetchLaunchPoolBucketV2(umi, lpBucket);
          if (!lpData) {
            throw new Error(
              `Cannot derive Raydium startTime: LaunchPool bucket index ${params.startTimeFromLaunchpoolBucketIndex} not found.`
            );
          }
          const depositEnd = lpData.depositEndCondition.time; // bigint unix seconds
          const offset = BigInt(params.startTimeOffsetSeconds ?? 60);
          startTimeInput = (depositEnd + offset).toString();
        }

        const startCondition = timeCondition(parseTime(startTimeInput));

        await transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 400_000 }))
          .add(
            addRaydiumCpmmBucketV2Base(umi, {
              genesisAccount: genesisAccountPk,
              bucket,
              bucketSigner,
              baseMint,
              quoteMint: WRAPPED_SOL_MINT,
              bucketSignerBaseTokenAccount,
              bucketSignerQuoteTokenAccount,
              baseTokenProgram: publicKey(
                "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
              ),
              quoteTokenProgram: publicKey(
                "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
              ),
              associatedTokenProgram: publicKey(
                "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
              ),
              bucketIndex,
              padding: PADDING_6,
              baseTokenAllocation,
              poolCreationFee: DEFAULT_POOL_CREATION_FEE,
              startCondition,
            })
          )
          .sendAndConfirm(umi);

        const result = {
          status: "success",
          bucket: bucket.toString(),
          bucketSigner: bucketSigner.toString(),
          bucketIndex,
          tokenAllocationPercent: params.tokenAllocationPercent,
          baseTokenAllocation: baseTokenAllocation.toString(),
          network,
          poolCreationFeeSol: "0.15",
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
