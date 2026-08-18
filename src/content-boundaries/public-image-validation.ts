import { lstat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export type PublicImageIssue = {
  url: string;
  code: "asset-missing" | "asset-unsafe" | "asset-invalid";
  message: string;
};

export async function validatePublicImages(
  publicRoot: string,
  urls: readonly string[],
  allowedFormats: readonly string[],
): Promise<{ valid: boolean; issues: PublicImageIssue[] }> {
  const issues: PublicImageIssue[] = [];
  for (const url of urls) {
    const file = path.join(publicRoot, url.replace(/^\/+/, ""));
    const stat = await lstat(file).catch(() => undefined);
    if (!stat) {
      issues.push({ url, code: "asset-missing", message: `${url} is missing` });
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      issues.push({
        url,
        code: "asset-unsafe",
        message: `${url} is not a safe regular file`,
      });
      continue;
    }
    try {
      const metadata = await sharp(file, { failOn: "error" }).metadata();
      if (
        !metadata.format ||
        !allowedFormats.includes(metadata.format) ||
        !metadata.width ||
        !metadata.height ||
        metadata.width < 1 ||
        metadata.height < 1
      ) {
        issues.push({
          url,
          code: "asset-invalid",
          message: `${url} is not a decodable ${allowedFormats.join("/")} image with valid dimensions`,
        });
      }
    } catch {
      issues.push({
        url,
        code: "asset-invalid",
        message: `${url} cannot be decoded`,
      });
    }
  }
  return { valid: issues.length === 0, issues };
}
