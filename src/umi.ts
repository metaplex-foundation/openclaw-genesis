import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { mplToolbox } from "@metaplex-foundation/mpl-toolbox";
import { mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { genesis } from "@metaplex-foundation/genesis";
import {
  createSignerFromKeypair,
  signerIdentity,
  type Umi,
} from "@metaplex-foundation/umi";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface UmiConfig {
  keypairPath?: string;
  rpcUrl?: string;
  network?: "mainnet" | "devnet";
}

let cachedUmi: Umi | null = null;
let cachedConfigHash: string | null = null;

function resolveHome(filepath: string): string {
  if (filepath.startsWith("~/")) {
    return resolve(homedir(), filepath.slice(2));
  }
  return resolve(filepath);
}

function configHash(cfg: UmiConfig): string {
  return JSON.stringify(cfg);
}

export function getUmi(pluginConfig?: UmiConfig): Umi {
  const cfg: UmiConfig = pluginConfig ?? {};
  const hash = configHash(cfg);

  if (cachedUmi && cachedConfigHash === hash) {
    return cachedUmi;
  }

  // Resolve keypair path: plugin config > env var > default
  const keypairPath =
    cfg.keypairPath ??
    process.env.SOLANA_KEYPAIR_PATH ??
    "~/.config/solana/id.json";

  const resolvedKeypairPath = resolveHome(keypairPath);

  // Resolve RPC URL: plugin config > env var > public endpoint
  const network = cfg.network ?? "mainnet";
  const defaultRpc =
    network === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com";
  const rpcUrl = cfg.rpcUrl ?? process.env.SOLANA_RPC_URL ?? defaultRpc;

  // Load keypair
  let keypairBytes: Uint8Array;
  try {
    const raw = readFileSync(resolvedKeypairPath, "utf-8");
    const parsed = JSON.parse(raw);
    keypairBytes = new Uint8Array(parsed);
  } catch (err) {
    throw new Error(
      `Failed to load Solana keypair from ${resolvedKeypairPath}: ${err instanceof Error ? err.message : String(err)}. ` +
        `Set keypairPath in plugin config or SOLANA_KEYPAIR_PATH env var.`
    );
  }

  // Create Umi instance
  const umi = createUmi(rpcUrl)
    .use(mplToolbox())
    .use(mplTokenMetadata())
    .use(genesis())
    .use(irysUploader());

  // Set identity from keypair
  const keypair = umi.eddsa.createKeypairFromSecretKey(keypairBytes);
  const signer = createSignerFromKeypair(umi, keypair);
  umi.use(signerIdentity(signer));

  cachedUmi = umi;
  cachedConfigHash = hash;

  return umi;
}

/** Get the network setting for Raydium config selection */
export function getNetwork(pluginConfig?: UmiConfig): "mainnet" | "devnet" {
  return pluginConfig?.network ?? "mainnet";
}
