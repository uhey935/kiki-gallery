import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { convertLegacyHomeMarkdown } from "./migration-converter.ts";
import {
  HOME_JA_ABOUT_INTRO_TEMPORARY_COPY,
  HOME_JA_ABOUT_INTRO_TEMPORARY_MARKER,
} from "./schema.ts";

export const homeMigrationSha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

const assets = [
  ["/images/home/artists-square.jpg", "public/images/home/artists-square.jpg"],
  [
    "/images/home/about-landscape.jpg",
    "public/images/home/about-landscape.jpg",
  ],
  ["/images/home/fallback-hero.webp", "public/images/home/fallback-hero.webp"],
] as const;

export type HomeMigrationManifest = {
  migrationVersion: 1;
  collection: "home";
  mode: "approved-migration";
  identity: { contentId: "home"; singleton: true };
  source: {
    path: string;
    byteLength: number;
    sha256: string;
    originalBase64: string;
  };
  targetPlan: {
    directory: string;
    exactInventory: ["index.yaml", "ja.md", "en.md"];
    finalTargetEvidence: "frozen-temporary-copy";
    files: Array<{
      path: string;
      content: string;
      sha256: string;
      byteLength: number;
    }>;
  };
  prerequisites: {
    jaAboutIntroHumanApproved: false;
    enAboutIntroHumanApproved: false;
    realMigrationAllowed: true;
    productionCutoverAllowed: false;
  };
  localizedCopy: {
    jaAboutIntro: {
      status: "temporary";
      approved: false;
      value: typeof HOME_JA_ABOUT_INTRO_TEMPORARY_COPY;
      marker: typeof HOME_JA_ABOUT_INTRO_TEMPORARY_MARKER;
    };
    enAboutIntro: {
      status: "placeholder";
      approved: false;
      value: "__TODO_HOME_EN_ABOUT_INTRO__";
    };
  };
  assets: Array<{
    canonicalUrl: string;
    path: string;
    byteLength: number;
    sha256: string;
    decodedFormat: "webp";
    mutated: false;
  }>;
  rollback: {
    sourcePath: string;
    originalBase64: string;
    byteLength: number;
    sha256: string;
  };
};

async function assertRegular(file: string) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`${file}: regular file required`);
  return stat;
}

function assertWebP(bytes: Buffer, file: string) {
  if (
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP"
  )
    throw new Error(`${file}: expected decoded WebP signature`);
}

export async function createHomeMigrationManifest(
  projectRoot: string,
): Promise<HomeMigrationManifest> {
  const root = path.resolve(projectRoot);
  const sourcePath = "src/content/home/home.md";
  const sourceFile = path.join(root, sourcePath);
  await assertRegular(sourceFile);
  const source = await readFile(sourceFile);
  const document = parseDocument(
    /^---\r?\n([\s\S]*?)\r?\n---/.exec(source.toString("utf8"))?.[1] ?? "",
    { strict: true, uniqueKeys: true },
  );
  if (document.errors.length) throw new Error("Invalid Home source evidence");
  const assetEvidence = [] as HomeMigrationManifest["assets"];
  for (const [canonicalUrl, assetPath] of assets) {
    const file = path.join(root, assetPath);
    await assertRegular(file);
    const bytes = await readFile(file);
    assertWebP(bytes, assetPath);
    assetEvidence.push({
      canonicalUrl,
      path: assetPath,
      byteLength: bytes.byteLength,
      sha256: homeMigrationSha256(bytes),
      decodedFormat: "webp",
      mutated: false,
    });
  }
  const targetDirectory = "src/content/home/home";
  const originalBase64 = source.toString("base64");
  const sha256 = homeMigrationSha256(source);
  const converted = convertLegacyHomeMarkdown(source, sourcePath, {
    jaAboutIntro: HOME_JA_ABOUT_INTRO_TEMPORARY_COPY,
    jaTemporary: true,
  });
  const convertedFiles = {
    "index.yaml": converted.shared,
    "ja.md": converted.ja,
    "en.md": converted.en,
  };
  return {
    migrationVersion: 1,
    collection: "home",
    mode: "approved-migration",
    identity: { contentId: "home", singleton: true },
    source: {
      path: sourcePath,
      byteLength: source.length,
      sha256,
      originalBase64,
    },
    targetPlan: {
      directory: targetDirectory,
      exactInventory: ["index.yaml", "ja.md", "en.md"],
      finalTargetEvidence: "frozen-temporary-copy",
      files: (["index.yaml", "ja.md", "en.md"] as const).map((name) => ({
        path: `${targetDirectory}/${name}`,
        content: convertedFiles[name],
        sha256: homeMigrationSha256(convertedFiles[name]),
        byteLength: Buffer.byteLength(convertedFiles[name]),
      })),
    },
    prerequisites: {
      jaAboutIntroHumanApproved: false,
      enAboutIntroHumanApproved: false,
      realMigrationAllowed: true,
      productionCutoverAllowed: false,
    },
    localizedCopy: {
      jaAboutIntro: {
        status: "temporary",
        approved: false,
        value: HOME_JA_ABOUT_INTRO_TEMPORARY_COPY,
        marker: HOME_JA_ABOUT_INTRO_TEMPORARY_MARKER,
      },
      enAboutIntro: {
        status: "placeholder",
        approved: false,
        value: "__TODO_HOME_EN_ABOUT_INTRO__",
      },
    },
    assets: assetEvidence,
    rollback: { sourcePath, originalBase64, byteLength: source.length, sha256 },
  };
}

export const serializeHomeMigrationManifest = (
  manifest: HomeMigrationManifest,
) => `${JSON.stringify(manifest, null, 2)}\n`;

export function verifyHomeRollbackEvidence(manifest: HomeMigrationManifest) {
  const bytes = Buffer.from(manifest.rollback.originalBase64, "base64");
  return (
    bytes.byteLength === manifest.rollback.byteLength &&
    homeMigrationSha256(bytes) === manifest.rollback.sha256 &&
    manifest.rollback.sourcePath === manifest.source.path
  );
}

const isCli =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli)
  process.stdout.write(
    serializeHomeMigrationManifest(
      await createHomeMigrationManifest(process.argv[2] ?? process.cwd()),
    ),
  );
