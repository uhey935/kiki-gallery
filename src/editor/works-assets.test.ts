import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { WORKS_ASSET_POLICY } from "./works-asset-policy.ts";
import {
  admitWorksAssetUpload,
  readWorksAssetInventory,
} from "./works-assets.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const work = (sources: string[]) =>
  `---\ntitle: Fixture\nartist: fixture\nimages:\n${sources
    .map((src) => `  - src: ${src}\n    alt: Fixture`)
    .join(
      "\n",
    )}\nsize: fixture\nmaterial: fixture\ninquiry:\n  type: none\n---\n`;

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "works-assets-"));
  const assets = path.join(root, "assets");
  const works = path.join(root, "works");
  await mkdir(assets);
  await mkdir(works);
  return { root, assets, works };
}

test("inventory reports regular, mismatched, shared, and orphan assets without mutation", async () => {
  const { assets, works } = await fixture();
  await writeFile(path.join(assets, "artist-one.png"), png);
  await writeFile(path.join(assets, "artist-mismatch.jpg"), png);
  await writeFile(path.join(assets, "artist-orphan.png"), png);
  await writeFile(
    path.join(works, "first.md"),
    work(["/images/works/artist-one.png", "/images/works/artist-mismatch.jpg"]),
  );
  await writeFile(
    path.join(works, "second.md"),
    work(["/images/works/artist-one.png"]),
  );

  const result = await readWorksAssetInventory(assets, works);
  assert.equal(result.audit.length, 0);
  assert.equal(
    result.assets.find(({ filename }) => filename === "artist-one.png")
      ?.referenceCount,
    2,
  );
  assert.deepEqual(
    result.assets.find(({ filename }) => filename === "artist-one.png")
      ?.referencedByWorks,
    ["first", "second"],
  );
  assert.deepEqual(
    result.assets.find(({ filename }) => filename === "artist-mismatch.jpg")
      ?.warnings,
    ["extension-content-mismatch"],
  );
  assert.equal(
    result.assets.find(({ filename }) => filename === "artist-orphan.png")
      ?.orphan,
    true,
  );
});

test("inventory isolates symlinks and makes orphan state unknown when references are invalid", async () => {
  const { assets, works } = await fixture();
  await writeFile(path.join(assets, "safe-file.png"), png);
  await symlink(
    path.join(assets, "safe-file.png"),
    path.join(assets, "linked-file.png"),
  );
  await writeFile(path.join(works, "broken.md"), "not frontmatter");
  const result = await readWorksAssetInventory(assets, works);
  assert.deepEqual(result.audit.map(({ code }) => code).sort(), [
    "asset-reference-invalid",
    "asset-unsafe-path",
  ]);
  assert.equal(result.assets[0].orphan, "unknown");
});

test("admission accepts a safe new image and returns stable rejection codes", () => {
  const accepted = admitWorksAssetUpload({
    filename: "artist-new.png",
    declaredMime: "image/png",
    bytes: png,
  });
  assert.equal(accepted.accepted, true);
  if (accepted.accepted) {
    assert.equal(accepted.proposedUrl, "/images/works/artist-new.png");
    assert.equal(accepted.media.width, 1);
    assert.equal(accepted.sha256, hash(png));
  }

  const cases = [
    [
      "asset-unsafe-path",
      { filename: "../artist.png", declaredMime: "image/png", bytes: png },
    ],
    [
      "asset-unsafe-path",
      { filename: "artist/nested.png", declaredMime: "image/png", bytes: png },
    ],
    [
      "asset-decode-failed",
      {
        filename: "artist-zero.png",
        declaredMime: "image/png",
        bytes: new Uint8Array(),
      },
    ],
    [
      "asset-decode-failed",
      {
        filename: "artist-bad.png",
        declaredMime: "image/png",
        bytes: Buffer.from("not an image"),
      },
    ],
    [
      "asset-unsupported-format",
      {
        filename: "artist-gif.png",
        declaredMime: "image/png",
        bytes: Buffer.from("GIF89a malformed"),
      },
    ],
    [
      "asset-type-mismatch",
      { filename: "artist-wrong.jpg", declaredMime: "image/jpeg", bytes: png },
    ],
    [
      "asset-type-mismatch",
      { filename: "artist-wrong.png", declaredMime: "image/jpeg", bytes: png },
    ],
    [
      "asset-too-large",
      {
        filename: "artist-large.png",
        declaredMime: "image/png",
        bytes: new Uint8Array(WORKS_ASSET_POLICY.maxBytes + 1),
      },
    ],
  ] as const;
  for (const [code, candidate] of cases) {
    const result = admitWorksAssetUpload(candidate);
    assert.equal(result.accepted, false);
    if (!result.accepted) assert.equal(result.code, code);
  }
});

test("admission distinguishes byte duplicates from filename collisions", () => {
  const duplicate = admitWorksAssetUpload(
    { filename: "artist-copy.png", declaredMime: "image/png", bytes: png },
    [{ filename: "artist-original.png", sha256: hash(png) }],
  );
  assert.equal(duplicate.accepted, false);
  if (!duplicate.accepted) {
    assert.equal(duplicate.code, "asset-duplicate");
    assert.deepEqual(duplicate.existingUrls, [
      "/images/works/artist-original.png",
    ]);
  }

  const collision = admitWorksAssetUpload(
    { filename: "artist-new.png", declaredMime: "image/png", bytes: png },
    [{ filename: "artist-new.png", sha256: "different" }],
  );
  assert.equal(collision.accepted, false);
  if (!collision.accepted) assert.equal(collision.code, "asset-name-conflict");
});

test("admission enforces decoded dimension bounds", () => {
  const hugeHeader = Buffer.from(png);
  hugeHeader.writeUInt32BE(WORKS_ASSET_POLICY.maxDimension + 1, 16);
  const result = admitWorksAssetUpload({
    filename: "artist-huge.png",
    declaredMime: "image/png",
    bytes: hugeHeader,
  });
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.equal(result.code, "asset-too-large");
});

test("real canonical inventory records the current compatibility debt and references", async () => {
  const result = await readWorksAssetInventory();
  assert.equal(result.assets.length, 7);
  assert.equal(
    result.assets.filter(
      ({ extensionMatchesFormat }) => !extensionMatchesFormat,
    ).length,
    5,
  );
  assert.equal(
    result.assets.filter(
      ({ referencedByWorks }) => referencedByWorks.length > 1,
    ).length,
    3,
  );
  assert.equal(
    result.assets.every(({ orphan }) => orphan === false),
    true,
  );
  assert.equal(result.audit.length, 0);
});
