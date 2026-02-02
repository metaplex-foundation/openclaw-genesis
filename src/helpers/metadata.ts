import { type Umi } from "@metaplex-foundation/umi";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

/** Map file extensions to MIME types */
function getMimeType(filepath: string): string {
  const ext = extname(filepath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] ?? "application/octet-stream";
}

export interface TokenMetadataInput {
  name: string;
  symbol: string;
  description: string;
  imagePath: string;
}

export interface UploadedMetadata {
  metadataUri: string;
  imageUri: string;
}

/**
 * Upload token image and metadata JSON to Arweave via Irys.
 * Returns the metadata URI to use in Genesis initializeV2.
 */
export async function uploadTokenMetadata(
  umi: Umi,
  input: TokenMetadataInput
): Promise<UploadedMetadata> {
  // Read and upload image
  const imageBuffer = readFileSync(input.imagePath);
  const fileName = basename(input.imagePath);
  const mimeType = getMimeType(input.imagePath);

  const [imageUri] = await umi.uploader.upload([
    {
      buffer: imageBuffer,
      fileName,
      displayName: fileName,
      uniqueName: `${input.symbol}-image`,
      contentType: mimeType,
      extension: extname(input.imagePath).slice(1),
      tags: [],
    },
  ]);

  // Upload metadata JSON
  const metadataUri = await umi.uploader.uploadJson({
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    image: imageUri,
  });

  return { metadataUri, imageUri };
}
