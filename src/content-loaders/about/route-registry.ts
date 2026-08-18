import type { AboutLocale } from "./schema.ts";

export type AboutRouteDecision =
  | { kind: "available"; href: "/about/" | "/en/about/" }
  | { kind: "unavailable" };

export const projectAboutRoute = (
  locale: AboutLocale,
  formallyCapable: boolean,
): AboutRouteDecision =>
  formallyCapable
    ? { kind: "available", href: locale === "ja" ? "/about/" : "/en/about/" }
    : { kind: "unavailable" };
