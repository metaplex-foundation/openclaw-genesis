import { Type } from "@sinclair/typebox";
import {
  publicKey,
  transactionBuilder,
} from "@metaplex-foundation/umi";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import {
  addLaunchPoolBucketV2Base,
  addLaunchPoolBucketV2Extensions,
  setLaunchPoolBucketV2Behaviors,
  findLaunchPoolBucketV2Pda,
  safeFetchLaunchPoolBucketV2,
  fetchGenesisAccountV2,
  WRAPPED_SOL_MINT,
  type LaunchPoolV2ExtensionArgs,
} from "@metaplex-foundation/genesis";
import { getUmi, type UmiConfig } from "../umi.js";
import {
  timeCondition,
  parseTime,
  hoursToSeconds,
  percentToAmount,
  solToLamports,
  sendQuoteTokenBehavior,
  PADDING_6,
  PADDING_3,
} from "../helpers/defaults.js";

export const AddLaunchpoolSchema = Type.Object({
  genesisAccount: Type.String({
    description: "Genesis account address (from genesis_create_launch result)",
  }),
  tokenAllocationPercent: Type.Number({
    description: "Percentage of total supply allocated to the launchpool (e.g. 60 for 60%)",
    minimum: 1,
    maximum: 100,
  }),
  depositStartTime: Type.Optional(
    Type.String({
      description:
        'When deposits open. "now", an ISO date (e.g. "2026-03-01T12:00:00Z"), or Unix timestamp. Defaults to "now".',
    })
  ),
  depositDurationHours: Type.Number({
    description: "How long the deposit period lasts in hours (e.g. 72 for 3 days)",
    minimum: 0.01,
  }),
  claimDelayHours: Type.Optional(
    Type.Number({
      description:
        "Hours after deposit ends before claiming starts. Defaults to 0 (claims start immediately after deposits end).",
      minimum: 0,
    })
  ),
  claimDurationHours: Type.Number({
    description: "How long the claim period lasts in hours (e.g. 168 for 7 days)",
    minimum: 0.01,
  }),
  minimumRaiseSol: Type.Optional(
    Type.Number({
      description:
        "Minimum SOL that must be raised for the launch to succeed. If not met, depositors can refund. Omit for no minimum.",
      minimum: 0,
    })
  ),
  sendQuoteTokenToRaydiumBucketIndex: Type.Optional(
    Type.Number({
      description:
        "Bucket index of the Raydium CPMM bucket to send raised SOL to after deposit period ends. " +
        "Set this to wire launchpool proceeds to Raydium liquidity. Omit if not using Raydium.",
    })
  ),
  bucketIndex: Type.Optional(
    Type.Number({
      description: "Bucket index for this launchpool. Defaults to 0. Only change if adding multiple launchpools.",
    })
  ),
});

export function createAddLaunchpoolTool(pluginConfig?: UmiConfig) {
  return {
    name: "genesis_add_launchpool",
    label: "Genesis: Add LaunchPool",
    description:
      "Add a LaunchPool bucket to a Genesis launch. A LaunchPool lets users deposit SOL during a deposit " +
      "period, then claim tokens proportionally during a claim period. Optionally sends raised SOL to a " +
      "Raydium pool for post-launch liquidity. Must be called after genesis_create_launch and before genesis_finalize_launch.",
    parameters: AddLaunchpoolSchema,
    async execute(
      _toolCallId: string,
      params: {
        genesisAccount: string;
        tokenAllocationPercent: number;
        depositStartTime?: string;
        depositDurationHours: number;
        claimDelayHours?: number;
        claimDurationHours: number;
        minimumRaiseSol?: number;
        sendQuoteTokenToRaydiumBucketIndex?: number;
        bucketIndex?: number;
      }
    ) {
      try {
        const umi = getUmi(pluginConfig);
        const genesisAccountPk = publicKey(params.genesisAccount);
        const bucketIndex = params.bucketIndex ?? 0;
        const debug: Record<string, unknown> = {
          genesisAccount: params.genesisAccount,
          bucketIndex,
          tokenAllocationPercent: params.tokenAllocationPercent,
          depositStartTime: params.depositStartTime ?? "now",
          depositDurationHours: params.depositDurationHours,
          claimDelayHours: params.claimDelayHours ?? 0,
          claimDurationHours: params.claimDurationHours,
          sendQuoteTokenToRaydiumBucketIndex: params.sendQuoteTokenToRaydiumBucketIndex ?? null,
        };

        // Fetch genesis account to get total supply
        const genesisData = await fetchGenesisAccountV2(umi, genesisAccountPk);
        const totalSupply = genesisData.totalSupplyBaseToken;
        const baseMint = genesisData.baseMint;

        // Calculate token allocation
        const baseTokenAllocation = percentToAmount(
          params.tokenAllocationPercent,
          totalSupply
        );
        debug.totalSupply = totalSupply.toString();
        debug.baseTokenAllocation = baseTokenAllocation.toString();

        // Calculate time conditions
        const depositStart = parseTime(params.depositStartTime ?? "now");
        const depositEnd = depositStart + hoursToSeconds(params.depositDurationHours);
        const claimStart =
          depositEnd + hoursToSeconds(params.claimDelayHours ?? 0);
        const claimEnd = claimStart + hoursToSeconds(params.claimDurationHours);

        // Derive bucket PDA
        const [bucket] = findLaunchPoolBucketV2Pda(umi, {
          genesisAccount: genesisAccountPk,
          bucketIndex,
        });

        // Step 1: Create base bucket (idempotent-ish)
        // If a previous run created the bucket but failed later (e.g. behavior wiring),
        // re-running should skip creation and proceed to extensions/behaviors.
        const existing = await safeFetchLaunchPoolBucketV2(umi, bucket);
        debug.bucketPda = bucket.toString();
        debug.bucketExists = !!existing;
        if (!existing) {
          await transactionBuilder()
            .add(setComputeUnitLimit(umi, { units: 400_000 }))
            .add(
              addLaunchPoolBucketV2Base(umi, {
                genesisAccount: genesisAccountPk,
                baseMint,
                bucketIndex,
                padding: PADDING_6,
                baseTokenAllocation,
                depositStartCondition: timeCondition(depositStart),
                depositEndCondition: timeCondition(depositEnd),
                claimStartCondition: timeCondition(claimStart),
                claimEndCondition: timeCondition(claimEnd),
              })
            )
            .sendAndConfirm(umi);
        }

        // Step 2: Add extensions if needed
        // Stash debug on global so we can include it in error returns.
        // (Tool responses don't have access to locals in the catch block once optimized.)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__openclawGenesisDebug = debug;

        const extensions: LaunchPoolV2ExtensionArgs[] = [];

        if (params.minimumRaiseSol != null) {
          extensions.push({
            __kind: "MinimumQuoteTokenThreshold",
            minimumQuoteTokenThreshold: {
              amount: solToLamports(params.minimumRaiseSol),
            },
          });
        }

        if (extensions.length > 0) {
          await addLaunchPoolBucketV2Extensions(umi, {
            genesisAccount: genesisAccountPk,
            bucket,
            padding: PADDING_3,
            extensions,
          }).sendAndConfirm(umi);
        }

        // Step 3: Set end behaviors
        const endBehaviors = [];

        if (params.sendQuoteTokenToRaydiumBucketIndex != null) {
          // Derive the Raydium bucket address to send SOL to
          const { findRaydiumCpmmBucketV2Pda } = await import(
            "@metaplex-foundation/genesis"
          );
          const [raydiumBucket] = findRaydiumCpmmBucketV2Pda(umi, {
            genesisAccount: genesisAccountPk,
            bucketIndex: params.sendQuoteTokenToRaydiumBucketIndex,
          });

          endBehaviors.push(sendQuoteTokenBehavior(raydiumBucket, 10_000)); // 100% to Raydium
          endBehaviors.push({
            __kind: "SendStartPrice" as const,
            padding: [0, 0, 0, 0, 0, 0],
            destinationBucket: raydiumBucket,
            processed: false,
          });
        } else {
          // Default: no-op behavior (send 0% to self)
          endBehaviors.push(sendQuoteTokenBehavior(bucket, 0));
        }

        await setLaunchPoolBucketV2Behaviors(umi, {
          genesisAccount: genesisAccountPk,
          bucket,
          padding: PADDING_3,
          endBehaviors,
        }).sendAndConfirm(umi);

        const result = {
          status: "success",
          bucket: bucket.toString(),
          bucketIndex,
          tokenAllocationPercent: params.tokenAllocationPercent,
          baseTokenAllocation: baseTokenAllocation.toString(),
          depositStart: new Date(Number(depositStart) * 1000).toISOString(),
          depositEnd: new Date(Number(depositEnd) * 1000).toISOString(),
          claimStart: new Date(Number(claimStart) * 1000).toISOString(),
          claimEnd: new Date(Number(claimEnd) * 1000).toISOString(),
          minimumRaiseSol: params.minimumRaiseSol ?? null,
          sendsToRaydium: params.sendQuoteTokenToRaydiumBucketIndex != null,
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          details: result,
        };
      } catch (err) {
        const errorObj: any = {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        };
        // Best-effort attach debug fields if present.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const maybeDebug = (globalThis as any).__openclawGenesisDebug;
          if (maybeDebug && typeof maybeDebug === "object") {
            errorObj.debug = maybeDebug;
          }
        } catch {}

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(errorObj, null, 2),
            },
          ],
        };
      }
    },
  };
}
