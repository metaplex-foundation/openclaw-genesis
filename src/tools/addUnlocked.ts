import { Type } from "@sinclair/typebox";
import {
  publicKey,
  transactionBuilder,
} from "@metaplex-foundation/umi";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import { findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";
import {
  addUnlockedBucketV2Base,
  findUnlockedBucketV2Pda,
  fetchGenesisAccountV2,
  WRAPPED_SOL_MINT,
} from "@metaplex-foundation/genesis";
import { getUmi, type UmiConfig } from "../umi.js";
import {
  timeCondition,
  parseTime,
  hoursToSeconds,
  percentToAmount,
  PADDING_6,
} from "../helpers/defaults.js";

export const AddUnlockedSchema = Type.Object({
  genesisAccount: Type.String({
    description: "Genesis account address (from genesis_create_launch result)",
  }),
  tokenAllocationPercent: Type.Number({
    description:
      "Percentage of total supply allocated to this unlocked bucket (e.g. 20 for 20%). " +
      "Can be 0 if this bucket only receives quote tokens from another bucket's end behavior.",
    minimum: 0,
    maximum: 100,
  }),
  claimStartTime: Type.Optional(
    Type.String({
      description:
        'When claiming opens. "now", an ISO date, or Unix timestamp. Defaults to "now".',
    })
  ),
  claimDurationHours: Type.Optional(
    Type.Number({
      description: "How long the claim period lasts in hours. Defaults to 8760 (1 year).",
      minimum: 0.01,
    })
  ),
  recipient: Type.Optional(
    Type.String({
      description:
        "Wallet address that can claim tokens from this bucket. Defaults to the launch authority (your wallet).",
    })
  ),
  bucketIndex: Type.Optional(
    Type.Number({
      description: "Bucket index. Defaults to 0. Increment if adding multiple unlocked buckets.",
    })
  ),
});

export function createAddUnlockedTool(pluginConfig?: UmiConfig) {
  return {
    name: "genesis_add_unlocked",
    label: "Genesis: Add Unlocked Bucket",
    description:
      "Add an Unlocked bucket to a Genesis launch for direct token distribution. Tokens in this " +
      "bucket can be claimed by the recipient during the claim period. Use for team allocations, " +
      "treasury, or airdrops. Must be called after genesis_create_launch and before genesis_finalize_launch.",
    parameters: AddUnlockedSchema,
    async execute(
      _toolCallId: string,
      params: {
        genesisAccount: string;
        tokenAllocationPercent: number;
        claimStartTime?: string;
        claimDurationHours?: number;
        recipient?: string;
        bucketIndex?: number;
      }
    ) {
      try {
        const umi = getUmi(pluginConfig);
        const genesisAccountPk = publicKey(params.genesisAccount);
        const bucketIndex = params.bucketIndex ?? 0;

        // Fetch genesis account to get total supply and base mint
        const genesisData = await fetchGenesisAccountV2(umi, genesisAccountPk);
        const totalSupply = genesisData.totalSupplyBaseToken;
        const baseMint = genesisData.baseMint;

        // Calculate allocation
        const baseTokenAllocation = percentToAmount(
          params.tokenAllocationPercent,
          totalSupply
        );

        // Time conditions
        const claimStart = parseTime(params.claimStartTime ?? "now");
        const claimDurationHours = params.claimDurationHours ?? 8760; // 1 year default
        const claimEnd = claimStart + hoursToSeconds(claimDurationHours);

        // Derive bucket PDA
        const [bucket] = findUnlockedBucketV2Pda(umi, {
          genesisAccount: genesisAccountPk,
          bucketIndex,
        });

        // Derive bucket quote token account
        const bucketQuoteTokenAccount = findAssociatedTokenPda(umi, {
          mint: WRAPPED_SOL_MINT,
          owner: bucket,
        });

        // Recipient defaults to the authority (payer)
        const recipient = params.recipient
          ? publicKey(params.recipient)
          : publicKey(umi.identity);

        await transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 400_000 }))
          .add(
            addUnlockedBucketV2Base(umi, {
              genesisAccount: genesisAccountPk,
              bucket,
              baseMint,
              quoteMint: WRAPPED_SOL_MINT,
              bucketQuoteTokenAccount,
              recipient,
              quoteTokenProgram: publicKey(
                "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
              ),
              associatedTokenProgram: publicKey(
                "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
              ),
              bucketIndex,
              padding: PADDING_6,
              baseTokenAllocation,
              claimStartCondition: timeCondition(claimStart),
              claimEndCondition: timeCondition(claimEnd),
            })
          )
          .sendAndConfirm(umi);

        const result = {
          status: "success",
          bucket: bucket.toString(),
          bucketIndex,
          tokenAllocationPercent: params.tokenAllocationPercent,
          baseTokenAllocation: baseTokenAllocation.toString(),
          recipient: recipient.toString(),
          claimStart: new Date(Number(claimStart) * 1000).toISOString(),
          claimEnd: new Date(Number(claimEnd) * 1000).toISOString(),
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
