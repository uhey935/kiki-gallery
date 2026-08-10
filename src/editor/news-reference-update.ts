import path from "node:path";

export type NewsReferenceKind = "artists" | "exhibitions";

export type NewsReferenceSpan = {
  contentId: string;
  oldValue: string;
  newValue: string;
  start: number;
  end: number;
};

export class NewsReferenceStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsReferenceStructureError";
  }
}

export function findNewsReferenceSpan(
  file: string,
  bytes: Buffer,
  kind: NewsReferenceKind,
  oldId: string,
  newId: string,
): NewsReferenceSpan | undefined {
  const normalized = file.split(path.sep).join("/");
  const legacy = normalized.match(/^src\/content\/news\/([^/]+)\.md$/);
  const shared = normalized.match(/^src\/content\/news\/([^/]+)\/index\.yaml$/);
  if (!legacy && !shared) return;

  const raw = bytes.toString("utf8");
  let searchable = raw;
  let searchableStart = 0;
  if (legacy) {
    const frontmatter = /^---(\r?\n)([\s\S]*?)\1---(?:\1|$)/.exec(raw);
    if (!frontmatter) {
      throw new NewsReferenceStructureError(
        `News frontmatter cannot be inventoried: ${normalized}`,
      );
    }
    searchable = frontmatter[2];
    searchableStart = frontmatter.index + 3 + frontmatter[1].length;
  }

  const oldRouteToken = `/${kind}/${oldId}`;
  const exact = new RegExp(
    `^(\\s*link\\s*:\\s*)(["']?)(${oldRouteToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?)(\\2)(\\s*(?:#.*)?)$`,
    "m",
  );
  const match = exact.exec(searchable);
  if (!match) {
    if (searchable.includes(oldRouteToken)) {
      throw new NewsReferenceStructureError(
        `Recognized ${kind} route cannot be byte-preservingly rewritten: ${normalized}`,
      );
    }
    return;
  }

  const oldValue = match[3];
  const newValue = oldValue.replace(oldRouteToken, `/${kind}/${newId}`);
  const characterStart =
    searchableStart + match.index + match[1].length + match[2].length;
  const start = Buffer.byteLength(raw.slice(0, characterStart));
  return {
    contentId: (legacy ?? shared)![1],
    oldValue,
    newValue,
    start,
    end: start + Buffer.byteLength(oldValue),
  };
}
