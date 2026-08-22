import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLegacyJournalMigrationManifest } from "./migration-manifest.ts";

const localized = `title: Legacy attribution
summary: Historical compatibility fixture
hero_alt: Historical image
date: 2026-08-06
categories:
  - interview
hero:
  image: /images/journal/historical.jpg
`;

test("historical v1 migration preserves legacy author and credits fields", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "journal-historical-attribution-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await Promise.all([
    fs.writeFile(
      path.join(root, "legacy-author.md"),
      `---\n${localized}author: legacy-author\n---\nAuthor body\n`,
    ),
    fs.writeFile(
      path.join(root, "legacy-credits.md"),
      `---\n${localized}credits:\n  - role: Photography\n    person: legacy-person\n  - role: Editing\n    member: legacy-member\n---\nCredits body\n`,
    ),
  ]);

  const manifest = await createLegacyJournalMigrationManifest(root);
  const author = manifest.entries.find(
    (entry) => entry.contentId === "legacy-author",
  );
  const credits = manifest.entries.find(
    (entry) => entry.contentId === "legacy-credits",
  );

  assert.equal(author?.shared.author, "legacy-author");
  assert.deepEqual(credits?.shared.credits, [
    { role: "Photography", person: "legacy-person" },
    { role: "Editing", member: "legacy-member" },
  ]);
});
