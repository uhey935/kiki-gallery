import { promises as fs } from "node:fs";
import path from "node:path";
import { stringify } from "yaml";

export const TEST_WORK_ID = "test-work";
export async function writeThreeFileWorkFixture(
  root: string,
  options: { enPlaceholder?: boolean } = {},
) {
  const directory = path.join(root, TEST_WORK_ID);
  await fs.mkdir(directory, { recursive: true });
  const shared = stringify({
    artist: "test-artist",
    images: [{ src: "/images/works/existing.png" }],
    year: 2026,
    inquiry: { type: "inquiry" },
  });
  const ja = `---\ntitle: Test Work\nimages:\n  - alt: Existing\nmaterial: Paper\nsize: H100 × W100 mm\n---\nBody\n`;
  const en =
    options.enPlaceholder === false
      ? `---\ntitle: Test Work EN\nimages:\n  - alt: Existing EN\nmaterial: Paper\nsize: H100 × W100 mm\n---\nEnglish body\n`
      : `---\ntitle: __TODO_WORK_TITLE__\nimages:\n  - alt: __TODO_WORK_IMAGE_ALT_1__\nmaterial: __TODO_WORK_MATERIAL__\nsize: __TODO_WORK_SIZE__\n---\n__TODO_WORK_BODY__`;
  await Promise.all([
    fs.writeFile(path.join(directory, "index.yaml"), shared),
    fs.writeFile(path.join(directory, "ja.md"), ja),
    fs.writeFile(path.join(directory, "en.md"), en),
  ]);
  return { directory, shared, ja, en };
}
