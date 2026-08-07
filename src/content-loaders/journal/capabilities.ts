import type { ContentIssue, LoadedJournalUnit, Locale } from "./contracts.ts";

export type CapabilityResult = {
  allowed: boolean;
  blockers: ContentIssue[];
  warnings: ContentIssue[];
};

export type ContentCapabilities = {
  save: CapabilityResult;
  preview: Record<Locale, CapabilityResult>;
  publish: CapabilityResult;
};

function result(
  blockers: ContentIssue[],
  all: ContentIssue[],
): CapabilityResult {
  return {
    allowed: blockers.length === 0,
    blockers,
    warnings: all.filter((item) => item.severity === "warning"),
  };
}

export function evaluateJournalCapabilities(
  unit: LoadedJournalUnit,
): ContentCapabilities {
  const saveBlockers = unit.issues.filter((item) =>
    ["parse", "structure", "conflict", "infrastructure"].includes(
      item.category,
    ),
  );
  const preview = (locale: Locale) =>
    unit.issues.filter(
      (item) =>
        item.severity === "error" &&
        (item.locale === locale || item.locale === undefined) &&
        (["parse", "structure", "unit-integrity"].includes(item.category) ||
          item.ruleId === "content.placeholder.unresolved"),
    );
  const publishBlockers = unit.issues.filter(
    (item) => item.severity === "error",
  );
  return {
    save: result(saveBlockers, unit.issues),
    preview: {
      ja: result(preview("ja"), unit.issues),
      en: result(preview("en"), unit.issues),
    },
    publish: result(publishBlockers, unit.issues),
  };
}
