import { TextDecoder } from "node:util";

export type AboutMappingClassification =
  | "verbatim"
  | "normalized"
  | "human-required"
  | "obsolete-drop"
  | "presentation-only";

export type AboutSourceMapping = {
  field: string;
  source: "about.astro" | "about.css";
  span: { start: number; end: number; raw: string };
  value: string | string[];
  classification: AboutMappingClassification;
  targetOwnership: "shared" | "localized" | "ja" | "en" | "renderer" | "none";
  approvalStatus: "not-required" | "required-unapproved";
};

const decode = (bytes: Buffer, source: string) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${source}: source is not valid UTF-8`);
  }
};

function one(raw: string, pattern: RegExp, label: string) {
  const match = pattern.exec(raw);
  if (!match || match.index === undefined)
    throw new Error(`About extraction missing ${label}`);
  const start = Buffer.byteLength(raw.slice(0, match.index));
  return {
    start,
    end: start + Buffer.byteLength(match[0]),
    raw: match[0],
    capture: match[1],
  };
}

function mapping(
  field: string,
  source: AboutSourceMapping["source"],
  match: ReturnType<typeof one>,
  classification: AboutMappingClassification,
  targetOwnership: AboutSourceMapping["targetOwnership"],
  value: string | string[] = match.capture,
): AboutSourceMapping {
  return {
    field,
    source,
    span: { start: match.start, end: match.end, raw: match.raw },
    value,
    classification,
    targetOwnership,
    approvalStatus:
      classification === "human-required"
        ? "required-unapproved"
        : "not-required",
  };
}

export function extractAboutSource(astroBytes: Buffer, cssBytes: Buffer) {
  const astro = decode(astroBytes, "about.astro");
  const css = decode(cssBytes, "about.css");
  const statement = one(
    astro,
    /<div class="about-statement-body">([\s\S]*?)<\/div>/,
    "statement",
  );
  const address = one(
    astro,
    /〒220-0004<br \/>\s*([^<]+むつみビル3階)/,
    "address",
  );
  const hours = one(astro, /<span>(Wed–Sat 12:00–18:00)<\/span>/, "hours");
  const email = one(astro, /mailto:([^"\s]+)"/, "email");
  const map = one(
    astro,
    /<li class="about-information-item about-information-address">[\s\S]*?<a href="([^"]+)"/,
    "map href",
  );
  const instagram = one(
    astro,
    /<li class="about-information-item">\s*<a\s*href="([^"]+)"[\s\S]*?aria-label="Instagram"/,
    "Instagram href",
  );
  const hero = one(css, /background-image:\s*url\("([^"]+)"\)/, "hero source");
  const images = [...astro.matchAll(/<img src="([^"]+)" alt="([^"]+)" \/>/g)];
  if (images.length !== 4)
    throw new Error("About extraction requires four gallery images");
  const layout = one(
    astro,
    /<Layout title="([^"]+)" description="([^"]+)">/,
    "SEO metadata",
  );
  const descriptionValue = /description="([^"]+)"/.exec(layout.raw)?.[1];
  if (!descriptionValue)
    throw new Error("About extraction missing SEO description");
  const script = one(
    astro,
    /<script>([\s\S]*?)<\/script>/,
    "presentation script",
  );

  const mappings: AboutSourceMapping[] = [
    mapping("statement", "about.astro", statement, "human-required", "ja"),
    mapping("address", "about.astro", address, "human-required", "ja"),
    mapping("hours", "about.astro", hours, "human-required", "shared"),
    mapping("contact.email", "about.astro", email, "human-required", "shared"),
    mapping("contact.map_url", "about.astro", map, "obsolete-drop", "none"),
    mapping(
      "contact.instagram_url",
      "about.astro",
      instagram,
      "obsolete-drop",
      "none",
    ),
    mapping("images.hero.src", "about.css", hero, "verbatim", "shared"),
  ];
  images.forEach((match, index) => {
    const start = Buffer.byteLength(astro.slice(0, match.index!));
    const span = {
      start,
      end: start + Buffer.byteLength(match[0]),
      raw: match[0],
      capture: match[1],
    };
    mappings.push(
      mapping(
        `images.gallery[${index}].src`,
        "about.astro",
        span,
        "verbatim",
        "shared",
      ),
      mapping(
        `images.gallery[${index}].alt`,
        "about.astro",
        { ...span, capture: match[2] },
        "human-required",
        "localized",
      ),
    );
  });
  mappings.push(
    mapping(
      "seo_title",
      "about.astro",
      layout,
      "human-required",
      "localized",
      layout.capture,
    ),
    mapping(
      "description",
      "about.astro",
      layout,
      "human-required",
      "localized",
      descriptionValue,
    ),
    mapping(
      "presentation.parallax",
      "about.astro",
      script,
      "presentation-only",
      "renderer",
    ),
  );
  return { mappings };
}
