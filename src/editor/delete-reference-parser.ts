export type DeleteRouteTarget = {
  collection: "journal" | "exhibitions" | "artists" | "works";
  contentId: string;
};

export type ParsedDeleteReference = {
  href: string;
  target?: DeleteRouteTarget;
  disposition:
    "supported-internal" | "external" | "fragment" | "unsupported-internal";
};

const supported =
  /^\/(journal|exhibitions|artists|works)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?(?:[?#].*)?$/;

export function classifyDeleteHref(href: string): ParsedDeleteReference {
  if (href.startsWith("#")) return { href, disposition: "fragment" };
  if (/^(?:https?:|mailto:|tel:)/i.test(href))
    return { href, disposition: "external" };
  const match = href.match(supported);
  if (match)
    return {
      href,
      disposition: "supported-internal",
      target: {
        collection: match[1] as DeleteRouteTarget["collection"],
        contentId: match[2],
      },
    };
  return { href, disposition: "unsupported-internal" };
}

export function parseMarkdownDeleteReferences(markdown: string) {
  const references: ParsedDeleteReference[] = [];
  const destinations = new Map<string, string>();
  for (const match of markdown.matchAll(/^\s*\[([^\]]+)\]:\s*(\S+)/gm))
    destinations.set(match[1].toLowerCase(), match[2]);
  const hrefs = [
    ...[
      ...markdown.matchAll(
        /!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g,
      ),
    ].map((m) => m[1] ?? m[2]),
    ...([...markdown.matchAll(/(?<!!)\[[^\]]+\]\[([^\]]+)\]/g)]
      .map((m) => destinations.get(m[1].toLowerCase()))
      .filter(Boolean) as string[]),
    ...[...markdown.matchAll(/<((?:https?:\/\/|\/)[^>]+)>/g)].map((m) => m[1]),
  ];
  for (const href of hrefs) references.push(classifyDeleteHref(href));
  return references;
}

export function assertClosedDeleteReferenceGraph(
  references: ParsedDeleteReference[],
) {
  const unsupported = references.filter(
    (item) => item.disposition === "unsupported-internal",
  );
  if (unsupported.length)
    throw new Error(
      `Unsupported internal references: ${unsupported.map((item) => item.href).join(", ")}`,
    );
  return references;
}
