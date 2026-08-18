import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validatePublicImages } from "../../content-boundaries/public-image-validation.ts";

test("formal image validation decodes bytes, verifies format and dimensions", async (t) => {
  const publicRoot = path.resolve(import.meta.dirname, "../../../public");
  const valid = await validatePublicImages(
    publicRoot,
    ["/images/about/about-hero.jpg"],
    ["jpeg"],
  );
  assert.equal(valid.valid, true);

  await t.test(
    "malformed bytes are rejected independently of extension",
    async () => {
      const directory = await mkdtemp(
        path.join(process.env.TMPDIR ?? "/tmp", "about-image-"),
      );
      await writeFile(path.join(directory, "fake.jpg"), "not an image");
      const invalid = await validatePublicImages(
        directory,
        ["/fake.jpg"],
        ["jpeg"],
      );
      assert.equal(invalid.valid, false);
      assert.equal(invalid.issues[0]?.code, "asset-invalid");
    },
  );
});
