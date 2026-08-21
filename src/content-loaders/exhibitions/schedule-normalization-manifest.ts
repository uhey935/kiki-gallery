import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { EXHIBITION_MIGRATION_INVENTORY } from "./migration-manifest.ts";

export const EXHIBITIONS_SCHEDULE_NORMALIZATION_VERSION = 2 as const;
export const EXHIBITIONS_SCHEDULE_PREIMAGE_SHA256 = {
  "alana-wilson-2027-04": {
    "index.yaml": "b9c708a984c818ebc2a46702b1d0808ddb5aee7a6a2c9c1b60c8b04557de4d37",
    "ja.md": "b80877c83476919cc07b51ba2201cf100a10ab5447caf13e186ae915ae77cc32",
    "en.md": "33b7f1feee54ab09809582e27d031391ca21d407b475548884053468d2448ba4",
  },
  "group-exhibition-2026-03": {
    "index.yaml": "7a413ee2ad9691bff537a310786498e845d987894218ec70c6bb06c92f598717",
    "ja.md": "0a59d3a1e2cb6951f3b2e20f0335efe291cebde334d8db046270a7cf24909e9c",
    "en.md": "24f8203212eca6c48311e218e0f71e3449827871ab0768b2c0a8535ccbb449be",
  },
  "keisuke-matsuda-2024-07": {
    "index.yaml": "99a8d21ecb77c243f1eb74eee6bcf0419cbd7e628ed49f0db4a238f2356ba569",
    "ja.md": "394f45a9919611054793dd1b09ed4893f477f05b1cfd75d59d8f7385083a44a8",
    "en.md": "676b605dcb5dee6b0a63b8746849c6aa2a7a04463b144606a271689dc18d6b64",
  },
  "reiko-kinoshita-2023-12": {
    "index.yaml": "9d5a838376cb58886460f83f5b9228a5b8eed9a4d36434dd45b464e40b6da931",
    "ja.md": "2532e417c6874d9f2cc3a3ce8530132161f766aeda205bfb55fef82cf2f905e9",
    "en.md": "7a35eb0df19ccc96f9fc7b87f15d6a576aa108afe1603dba2d4a06495807eec1",
  },
  "yuka-mori-2025-07": {
    "index.yaml": "63ae8a89196fac1ee3ba645988064f826bdf87fb4ab63a761102252eb86b30c9",
    "ja.md": "aa23029cc5831866ac58473ef66ee06c42d6ed8ae12dc8fd8fdf3a750f5e2414",
    "en.md": "473f95135ecf1f9b66c7804380e8f0b897287ea5fa676ecfee8e728f93ef53f5",
  },
} as const;

const FILES = ["index.yaml", "ja.md", "en.md"] as const;
export const exhibitionScheduleSha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

export type ScheduleNormalizationFile = {
  name: (typeof FILES)[number];
  preimage: Buffer;
  preimageSha256: string;
  postimage: Buffer;
  postimageSha256: string;
};
export type ScheduleNormalizationManifest = {
  version: 2;
  collection: "exhibitions";
  entries: Array<{
    contentId: string;
    files: ScheduleNormalizationFile[];
  }>;
};
export type ScheduleNormalizationExpectedHashes = Record<
  string,
  Record<(typeof FILES)[number], string>
>;

function frontmatter(raw: string, source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) throw new Error(`${source}: malformed frontmatter`);
  return parse(match[1]) as Record<string, unknown>;
}

function normalizeIndex(raw: string, source: string) {
  const data = parse(raw) as Record<string, unknown>;
  if ("opening_hours" in data || "closed_weekdays" in data)
    throw new Error(`${source}: schedule already normalized`);
  const marker = "hero:\n";
  if (raw.split(marker).length !== 2)
    throw new Error(`${source}: expected one hero field`);
  return raw.replace(
    marker,
    "opening_hours:\n  opens: 13:00\n  closes: 17:00\nclosed_weekdays:\n  - wed\n  - thu\n" + marker,
  );
}

function normalizeJa(raw: string, source: string) {
  const data = frontmatter(raw, source);
  if (
    data.opening_hours !== "13:00-17:00" ||
    data.closed_days !== "水曜・木曜"
  )
    throw new Error(`${source}: localized schedule drift`);
  const opening = /^opening_hours: 13:00-17:00\r?\n/m;
  const closed = /^closed_days: 水曜・木曜\r?\n/m;
  if (!opening.test(raw) || !closed.test(raw))
    throw new Error(`${source}: expected exact schedule lines`);
  return raw.replace(opening, "").replace(closed, "");
}

function verifyEn(raw: string, source: string) {
  const data = frontmatter(raw, source);
  if ("opening_hours" in data || "closed_days" in data)
    throw new Error(`${source}: unexpected localized schedule`);
  return raw;
}

export async function createScheduleNormalizationManifest(
  root: string,
  expectedHashes: ScheduleNormalizationExpectedHashes =
    EXHIBITIONS_SCHEDULE_PREIMAGE_SHA256,
): Promise<ScheduleNormalizationManifest> {
  const absolute = path.resolve(root);
  const inventory = await fs.readdir(absolute, { withFileTypes: true });
  const ids = inventory
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  if (
    inventory.length !== ids.length ||
    JSON.stringify(ids) !== JSON.stringify(EXHIBITION_MIGRATION_INVENTORY)
  )
    throw new Error("Exhibition schedule normalization inventory drift");
  const entries = [] as ScheduleNormalizationManifest["entries"];
  for (const contentId of ids) {
    const files = [] as ScheduleNormalizationFile[];
    for (const name of FILES) {
      const file = path.join(absolute, contentId, name);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(`${contentId}/${name}: unsafe preimage`);
      const preimage = await fs.readFile(file);
      const expected = expectedHashes[contentId]?.[name];
      const preimageSha256 = exhibitionScheduleSha256(preimage);
      if (!expected || preimageSha256 !== expected)
        throw new Error(`${contentId}/${name}: preimage drift`);
      const raw = preimage.toString("utf8");
      const post =
        name === "index.yaml"
          ? normalizeIndex(raw, `${contentId}/${name}`)
          : name === "ja.md"
            ? normalizeJa(raw, `${contentId}/${name}`)
            : verifyEn(raw, `${contentId}/${name}`);
      const postimage = Buffer.from(post);
      files.push({
        name,
        preimage,
        preimageSha256,
        postimage,
        postimageSha256: exhibitionScheduleSha256(postimage),
      });
    }
    entries.push({ contentId, files });
  }
  return {
    version: EXHIBITIONS_SCHEDULE_NORMALIZATION_VERSION,
    collection: "exhibitions",
    entries,
  };
}
