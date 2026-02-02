import { Type } from "@sinclair/typebox";
import { publicKey } from "@metaplex-foundation/umi";
import {
  fetchGenesisAccountV2,
  safeFetchLaunchPoolBucketV2,
  safeFetchUnlockedBucketV2,
  safeFetchRaydiumCpmmBucketV2,
} from "@metaplex-foundation/genesis";
import {
  findLaunchPoolBucketV2Pda,
  findUnlockedBucketV2Pda,
  findRaydiumCpmmBucketV2Pda,
} from "@metaplex-foundation/genesis";
import { getUmi, type UmiConfig } from "../umi.js";

export const LaunchStatusSchema = Type.Object({
  genesisAccount: Type.String({
    description: "Genesis account address to check status for",
  }),
});

export function createLaunchStatusTool(pluginConfig?: UmiConfig) {
  return {
    name: "genesis_launch_status",
    label: "Genesis: Launch Status",
    description:
      "Check the current status of a Metaplex Genesis token launch. Returns the genesis " +
      "account state, bucket configurations, and allocation details.",
    parameters: LaunchStatusSchema,
    async execute(
      _toolCallId: string,
      params: { genesisAccount: string }
    ) {
      try {
        const umi = getUmi(pluginConfig);
        const genesisAccountPk = publicKey(params.genesisAccount);

        const genesisData = await fetchGenesisAccountV2(umi, genesisAccountPk);

        // Try to fetch known bucket types (up to 5 of each)
        const buckets: Record<string, unknown[]> = {
          launchpools: [],
          unlocked: [],
          raydium: [],
        };

        for (let i = 0; i < 5; i++) {
          const [lpPda] = findLaunchPoolBucketV2Pda(umi, {
            genesisAccount: genesisAccountPk,
            bucketIndex: i,
          });
          const lpData = await safeFetchLaunchPoolBucketV2(umi, lpPda);
          if (lpData) {
            buckets.launchpools.push({
              bucketIndex: i,
              address: lpPda.toString(),
              baseTokenAllocation: lpData.bucket.baseTokenAllocation.toString(),
              totalDeposited: lpData.quoteTokenDepositTotal?.toString() ?? "0",
            });
          }

          const [ulPda] = findUnlockedBucketV2Pda(umi, {
            genesisAccount: genesisAccountPk,
            bucketIndex: i,
          });
          const ulData = await safeFetchUnlockedBucketV2(umi, ulPda);
          if (ulData) {
            buckets.unlocked.push({
              bucketIndex: i,
              address: ulPda.toString(),
              baseTokenAllocation: ulData.bucket.baseTokenAllocation.toString(),
            });
          }

          const [ryPda] = findRaydiumCpmmBucketV2Pda(umi, {
            genesisAccount: genesisAccountPk,
            bucketIndex: i,
          });
          const ryData = await safeFetchRaydiumCpmmBucketV2(umi, ryPda);
          if (ryData) {
            buckets.raydium.push({
              bucketIndex: i,
              address: ryPda.toString(),
              baseTokenAllocation: ryData.bucket.baseTokenAllocation.toString(),
            });
          }
        }

        const result = {
          status: "success",
          genesisAccount: params.genesisAccount,
          authority: genesisData.authority.toString(),
          baseMint: genesisData.baseMint.toString(),
          quoteMint: genesisData.quoteMint.toString(),
          finalized: genesisData.finalized,
          totalSupply: genesisData.totalSupplyBaseToken.toString(),
          totalAllocated:
            genesisData.totalAllocatedSupplyBaseToken.toString(),
          allocationRemaining: (
            genesisData.totalSupplyBaseToken -
            genesisData.totalAllocatedSupplyBaseToken
          ).toString(),
          bucketCount: genesisData.bucketCount,
          buckets,
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
