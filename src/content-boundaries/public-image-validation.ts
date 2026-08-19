import { lstat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export type PublicImageIssue = {
  url: string;
  filePath: string;
  code: "asset-missing" | "asset-unsafe" | "asset-invalid";
  message: string;
};

export const resolveProjectPublicRoot = (projectRoot = process.cwd()) =>
  path.resolve(projectRoot, "public");

export function resolvePublicAssetPath(publicRoot: string, url: string) {
  const root = path.resolve(publicRoot);
  const relative = url.replace(/^\/+/, "");
  const filePath = path.resolve(root, relative);
  const insideRoot =
    filePath !== root && filePath.startsWith(`${root}${path.sep}`);
  return { filePath, insideRoot };
}

export async function validatePublicImages(
  publicRoot: string,
  urls: readonly string[],
  allowedFormats: readonly string[],
): Promise<{ valid: boolean; issues: PublicImageIssue[] }> {
  const issues: PublicImageIssue[] = [];
  for (const url of urls) {
    const { filePath: file, insideRoot } = resolvePublicAssetPath(
      publicRoot,
      url,
    );
    if (!insideRoot) {
      issues.push({
        url,
        filePath: file,
        code: "asset-unsafe",
        message: `${url} resolves outside the public asset root`,
      });
      continue;
    }
    const stat = await lstat(file).catch(() => undefined);
    if (!stat) {
      issues.push({
        url,
        filePath: file,
        code: "asset-missing",
        message: `${url} is missing at ${file}`,
      });
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      issues.push({
        url,
        filePath: file,
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
          filePath: file,
          code: "asset-invalid",
          message: `${url} is not a decodable ${allowedFormats.join("/")} image with valid dimensions`,
        });
      }
    } catch (error) {
      issues.push({
        url,
        filePath: file,
        code: "asset-invalid",
        message: `${url} cannot be decoded: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { valid: issues.length === 0, issues };
}
