import { NOT_TRIGGERED_TIMESTAMP } from "@metaplex-foundation/genesis";
import type { ConditionArgs, BehaviorArgs } from "@metaplex-foundation/genesis";
import type { PublicKey } from "@metaplex-foundation/umi";

/** Default total supply: 1 billion tokens with 9 decimals */
export const DEFAULT_TOTAL_SUPPLY = 1_000_000_000n * 1_000_000_000n; // 1B * 10^9

/** Default decimals */
export const DEFAULT_DECIMALS = 9;

/** Default Raydium pool creation fee in lamports (0.15 SOL) */
export const DEFAULT_POOL_CREATION_FEE = 150_000_000n;

/** Padding arrays used by Genesis V2 instructions */
export const PADDING_3 = Array(3).fill(0);
export const PADDING_4 = Array(4).fill(0);
export const PADDING_6 = Array(6).fill(0);
export const PADDING_7 = Array(7).fill(0);
export const PADDING_47 = Array(47).fill(0);

/** Create a TimeAbsolute condition from a Unix timestamp (seconds) */
export function timeCondition(unixSeconds: bigint): ConditionArgs {
  return {
    __kind: "TimeAbsolute",
    padding: PADDING_47,
    time: unixSeconds,
    triggeredTimestamp: NOT_TRIGGERED_TIMESTAMP,
  };
}

/** Parse a time input into a Unix timestamp in seconds.
 *  Accepts: "now", ISO 8601 string, or Unix timestamp number/string.
 */
export function parseTime(input: string | number): bigint {
  if (input === "now") {
    return BigInt(Math.floor(Date.now() / 1000));
  }
  if (typeof input === "number") {
    return BigInt(input);
  }
  // Try ISO date string
  const ms = Date.parse(input);
  if (!isNaN(ms)) {
    return BigInt(Math.floor(ms / 1000));
  }
  // Try as raw unix timestamp string
  const num = Number(input);
  if (!isNaN(num)) {
    return BigInt(Math.floor(num));
  }
  throw new Error(`Cannot parse time: "${input}". Use "now", an ISO date, or a Unix timestamp.`);
}

/** Convert hours to seconds as bigint */
export function hoursToSeconds(hours: number): bigint {
  return BigInt(Math.floor(hours * 3600));
}

/** Convert a percentage (0-100) to token amount based on total supply */
export function percentToAmount(percent: number, totalSupply: bigint): bigint {
  return (totalSupply * BigInt(Math.round(percent * 100))) / 10_000n;
}

/** Convert SOL (as a number) to lamports */
export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1_000_000_000));
}

/** Create a SendQuoteTokenPercentage behavior */
export function sendQuoteTokenBehavior(
  destinationBucket: PublicKey,
  percentageBps: number = 10_000
): BehaviorArgs {
  return {
    __kind: "SendQuoteTokenPercentage",
    padding: PADDING_4,
    destinationBucket,
    percentageBps,
    processed: false,
  };
}

/** Create a SendStartPrice behavior */
export function sendStartPriceBehavior(
  destinationBucket: PublicKey
): BehaviorArgs {
  return {
    __kind: "SendStartPrice",
    padding: [0, 0, 0, 0, 0, 0],
    destinationBucket,
    processed: false,
  };
}
