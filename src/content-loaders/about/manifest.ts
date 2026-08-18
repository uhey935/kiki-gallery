import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractAboutSource, type AboutSourceMapping } from "./extraction.ts";
import { planAboutMigration } from "./converter.ts";
import { ABOUT_ASSET_URLS } from "./schema.ts";

export const aboutSha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

export type AboutAssetEvidence = {
  canonicalUrl: string;
  path: string;
  byteLength: number;
  sha256: string;
  decodedFormat: "jpeg";
  width: number;
  height: number;
  regularFile: true;
  symlink: false;
  mutated: false;
};

export type AboutMigrationManifest = {
  migrationVersion: 1;
  collection: "about";
  mode: "provisional-tooling-evidence";
  identity: { contentId: "about"; singleton: true };
  source: {
    path: "src/pages/about.astro";
    byteLength: number;
    sha256: string;
    originalBase64: string;
  };
  presentationEvidence: {
    path: "src/styles/about.css";
    byteLength: number;
    sha256: string;
  };
  mapping: AboutSourceMapping[];
  targetPlan: {
    directory: "src/content/about/about";
    exactInventory: ["index.yaml", "ja.md", "en.md"];
    evidenceStatus: "provisional-placeholder-plan";
    finalHumanApprovedHashes: null;
    files: Array<{
      path: string;
      content: string;
      byteLength: number;
      sha256: string;
      provisional: true;
    }>;
  };
  assets: AboutAssetEvidence[];
  humanGates: {
    hoursApproved: false;
    emailApproved: false;
    mapUrlApproved: false;
    instagramUrlApproved: false;
    jaStatementApproved: false;
    enStatementApproved: false;
    jaAddressApproved: false;
    enAddressApproved: false;
    jaAltsApproved: false;
    enAltsApproved: false;
  };
  authorization: {
    realMigrationAllowed: false;
    productionCutoverAllowed: false;
    assetMutationAllowed: false;
  };
  rollback: {
    sourcePath: "src/pages/about.astro";
    originalBase64: string;
    byteLength: number;
    sha256: string;
    currentRouteImplementationPreserved: true;
  };
};

async function regular(file: string) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`${file}: regular file required`);
  return stat;
}

function jpegDimensions(bytes: Buffer, file: string) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error(`${file}: expected JPEG signature`);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length)
      throw new Error(`${file}: invalid JPEG segment`);
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    )
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    offset += 2 + length;
  }
  throw new Error(`${file}: JPEG dimensions unavailable`);
}

export async function createAboutMigrationManifest(
  projectRoot: string,
): Promise<AboutMigrationManifest> {
  const root = path.resolve(projectRoot);
  const sourcePath = "src/pages/about.astro" as const;
  const cssPath = "src/styles/about.css" as const;
  const sourceFile = path.join(root, sourcePath);
  const cssFile = path.join(root, cssPath);
  await regular(sourceFile);
  await regular(cssFile);
  const source = await readFile(sourceFile);
  const css = await readFile(cssFile);
  const extraction = extractAboutSource(source, css);
  const plan = planAboutMigration();
  const targetDirectory = "src/content/about/about" as const;
  const assets: AboutAssetEvidence[] = [];
  for (const canonicalUrl of ABOUT_ASSET_URLS) {
    const assetPath = `public${canonicalUrl}`;
    const file = path.join(root, assetPath);
    await regular(file);
    const bytes = await readFile(file);
    const dimensions = jpegDimensions(bytes, assetPath);
    assets.push({
      canonicalUrl,
      path: assetPath,
      byteLength: bytes.byteLength,
      sha256: aboutSha256(bytes),
      decodedFormat: "jpeg",
      ...dimensions,
      regularFile: true,
      symlink: false,
      mutated: false,
    });
  }
  if (new Set(assets.map(({ sha256 }) => sha256)).size !== assets.length)
    throw new Error("About assets contain duplicate bytes");
  const originalBase64 = source.toString("base64");
  const sha256 = aboutSha256(source);
  return {
    migrationVersion: 1,
    collection: "about",
    mode: "provisional-tooling-evidence",
    identity: { contentId: "about", singleton: true },
    source: {
      path: sourcePath,
      byteLength: source.byteLength,
      sha256,
      originalBase64,
    },
    presentationEvidence: {
      path: cssPath,
      byteLength: css.byteLength,
      sha256: aboutSha256(css),
    },
    mapping: extraction.mappings,
    targetPlan: {
      directory: targetDirectory,
      exactInventory: ["index.yaml", "ja.md", "en.md"],
      evidenceStatus: "provisional-placeholder-plan",
      finalHumanApprovedHashes: null,
      files: (["index.yaml", "ja.md", "en.md"] as const).map((name) => ({
        path: `${targetDirectory}/${name}`,
        content: plan.files[name],
        byteLength: Buffer.byteLength(plan.files[name]),
        sha256: aboutSha256(plan.files[name]),
        provisional: true as const,
      })),
    },
    assets,
    humanGates: {
      hoursApproved: false,
      emailApproved: false,
      mapUrlApproved: false,
      instagramUrlApproved: false,
      jaStatementApproved: false,
      enStatementApproved: false,
      jaAddressApproved: false,
      enAddressApproved: false,
      jaAltsApproved: false,
      enAltsApproved: false,
    },
    authorization: {
      realMigrationAllowed: false,
      productionCutoverAllowed: false,
      assetMutationAllowed: false,
    },
    rollback: {
      sourcePath,
      originalBase64,
      byteLength: source.byteLength,
      sha256,
      currentRouteImplementationPreserved: true,
    },
  };
}

export const serializeAboutMigrationManifest = (
  manifest: AboutMigrationManifest,
) => `${JSON.stringify(manifest, null, 2)}\n`;

export function verifyAboutRollbackEvidence(manifest: AboutMigrationManifest) {
  const bytes = Buffer.from(manifest.rollback.originalBase64, "base64");
  return (
    bytes.byteLength === manifest.rollback.byteLength &&
    aboutSha256(bytes) === manifest.rollback.sha256 &&
    manifest.rollback.sourcePath === manifest.source.path &&
    bytes.equals(Buffer.from(manifest.source.originalBase64, "base64"))
  );
}

const isCli =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli)
  process.stdout.write(
    serializeAboutMigrationManifest(
      await createAboutMigrationManifest(process.argv[2] ?? process.cwd()),
    ),
  );
