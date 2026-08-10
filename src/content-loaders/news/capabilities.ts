import type {
  LoadedNewsUnit,
  NewsContentIssue,
  NewsLocale,
} from "./contracts.ts";

export type NewsCapabilityResult = {
  allowed: boolean;
  blockers: NewsContentIssue[];
  warnings: NewsContentIssue[];
};

export type NewsContentCapabilities = {
  save: NewsCapabilityResult;
  preview: Record<NewsLocale, NewsCapabilityResult>;
  publish: NewsCapabilityResult;
};

function result(
  blockers: NewsContentIssue[],
  all: NewsContentIssue[],
): NewsCapabilityResult {
  return {
    allowed: blockers.length === 0,
    blockers,
    warnings: all.filter((item) => item.severity === "warning"),
  };
}

export function evaluateNewsCapabilities(
  unit: LoadedNewsUnit,
): NewsContentCapabilities {
  const saveBlockers = unit.issues.filter((item) =>
    ["parse", "structure", "conflict", "infrastructure"].includes(
      item.category,
    ),
  );
  const preview = (locale: NewsLocale) =>
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
