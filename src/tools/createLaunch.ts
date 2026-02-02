import { Type } from "@sinclair/typebox";
import {
  generateSigner,
  publicKey,
  transactionBuilder,
} from "@metaplex-foundation/umi";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import {
  initializeV2,
  findGenesisAccountV2Pda,
  WRAPPED_SOL_MINT,
} from "@metaplex-foundation/genesis";
import { getUmi, type UmiConfig } from "../umi.js";
import { uploadTokenMetadata } from "../helpers/metadata.js";
import {
  DEFAULT_TOTAL_SUPPLY,
  DEFAULT_DECIMALS,
} from "../helpers/defaults.js";

export const CreateLaunchSchema = Type.Object({
  name: Type.String({ description: "Token name (e.g. 'MeowCoin')" }),
  symbol: Type.String({ description: "Token ticker symbol (e.g. 'MEOW')" }),
  description: Type.String({ description: "Short description of the token" }),
  imagePath: Type.String({
    description: "Absolute file path to the token image (PNG, JPG, GIF, SVG, or WebP)",
  }),
  totalSupply: Type.Optional(
    Type.Number({
      description:
        "Total token supply as a whole number (e.g. 1000000000 for 1 billion). Defaults to 1 billion.",
    })
  ),
  decimals: Type.Optional(
    Type.Number({
      description: "Token decimals. Defaults to 9.",
      minimum: 0,
      maximum: 9,
    })
  ),
});

export function createCreateLaunchTool(pluginConfig?: UmiConfig) {
  return {
    name: "genesis_create_launch",
    label: "Genesis: Create Launch",
    description:
      "Create a new Metaplex Genesis token launch. Uploads token image and metadata to Arweave, " +
      "creates the token mint, and initializes the Genesis account. " +
      "Returns the genesis account address and token mint needed for subsequent bucket configuration. " +
      "After creating, add buckets (launchpool, unlocked, raydium) then finalize.",
    parameters: CreateLaunchSchema,
    async execute(
      _toolCallId: string,
      params: {
        name: string;
        symbol: string;
        description: string;
        imagePath: string;
        totalSupply?: number;
        decimals?: number;
      }
    ) {
      try {
        const umi = getUmi(pluginConfig);
        const decimals = params.decimals ?? DEFAULT_DECIMALS;
        const totalSupplyRaw = params.totalSupply
          ? BigInt(params.totalSupply) * BigInt(10 ** decimals)
          : DEFAULT_TOTAL_SUPPLY;

        // Upload metadata to Arweave via Irys
        const { metadataUri, imageUri } = await uploadTokenMetadata(umi, {
          name: params.name,
          symbol: params.symbol,
          description: params.description,
          imagePath: params.imagePath,
        });

        // Generate token mint keypair
        const baseMint = generateSigner(umi);

        // Derive Genesis account PDA
        const [genesisAccount] = findGenesisAccountV2Pda(umi, {
          baseMint: publicKey(baseMint),
          genesisIndex: 0,
        });

        // Initialize Genesis account
        await transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 400_000 }))
          .add(
            initializeV2(umi, {
              baseMint,
              quoteMint: WRAPPED_SOL_MINT,
              totalSupplyBaseToken: totalSupplyRaw,
              name: params.name,
              symbol: params.symbol,
              uri: metadataUri,
              decimals,
              fundingMode: 0,
              genesisIndex: 0,
            })
          )
          .sendAndConfirm(umi);

        const result = {
          status: "success",
          genesisAccount: genesisAccount.toString(),
          baseMint: baseMint.publicKey.toString(),
          metadataUri,
          imageUri,
          totalSupply: params.totalSupply ?? 1_000_000_000,
          decimals,
          network: pluginConfig?.network ?? "mainnet",
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
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
                  error:
                    err instanceof Error ? err.message : String(err),
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
