import type {
  ContentIssue,
  Locale,
} from "../content-loaders/journal/contracts.ts";
import type { JournalEditorDraftState } from "./journal-draft-state.ts";

export type EditorFailureAction = "reload" | "retry" | "review";

export type EditorFailureGuidance = {
  action: EditorFailureAction;
  message: string;
};

export function flatIssueFieldCandidates(fieldPath: string): string[] {
  const candidates = [fieldPath, fieldPath.replaceAll(".", "_")];
  const section = /^sections\.(\d+)\.(.+)$/.exec(fieldPath);
  if (section) candidates.push(`section_${section[1]}_${section[2]}`);
  return [...new Set(candidates)];
}

export function renderFlatValidationPanel(
  form: HTMLFormElement,
  result: {
    issues: ContentIssue[];
    capabilities: { save: boolean; preview: boolean; publish: boolean };
  },
) {
  const panel = document.querySelector<HTMLElement>(".editor-validation");
  if (!panel) return;
  const blocked = result.issues.length > 0;
  const badge = panel.querySelector<HTMLElement>("[data-validation-status]");
  const summary = panel.querySelector<HTMLElement>("[data-issue-summary]");
  const issues = panel.querySelector<HTMLUListElement>("[data-issues]");
  if (badge) {
    badge.textContent = blocked ? "blocked" : "valid";
    badge.classList.toggle("editor-status--blocked", blocked);
    badge.classList.toggle("editor-status--valid", !blocked);
  }
  if (summary)
    summary.textContent = blocked
      ? `${result.issues.length} draft issues`
      : "No draft issues";
  for (const action of ["save", "preview", "publish"] as const) {
    const value = panel.querySelector<HTMLElement>(`[data-${action}]`);
    if (value)
      value.textContent = result.capabilities[action] ? "Available" : "Blocked";
  }
  if (!issues) return;
  issues.replaceChildren();
  issues.hidden = !blocked;
  for (const issue of result.issues) {
    const item = document.createElement("li");
    const severity = document.createElement("strong");
    severity.textContent = issue.severity;
    const field = document.createElement("span");
    field.textContent = issue.fieldPath ?? "Source";
    const message = document.createElement("small");
    message.textContent = issue.messageKey;
    item.append(severity, " ", field, " ", message);
    const target = issue.fieldPath
      ? flatIssueFieldCandidates(issue.fieldPath)
          .map((name) => form.elements.namedItem(name))
          .find(
            (control): control is HTMLElement => control instanceof HTMLElement,
          )
      : undefined;
    if (target) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Go to field";
      button.addEventListener("click", () => {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus({ preventScroll: true });
      });
      item.append(" ", button);
    }
    issues.append(item);
  }
}

export function worksWorkspaceUxState(input: {
  collectionName: "Work" | "Artist" | "Exhibition" | "News" | "Home";
  pending: "save" | "preview" | "publish" | "upload" | null;
  dirty: boolean;
  canSave: boolean;
  canPreview: boolean;
  canPublish: boolean;
  savedSincePublish: boolean;
  recoveryRequired?: boolean;
  statusMessage?: string | null;
}) {
  const { pending, dirty, canSave, canPreview, canPublish } = input;
  const busy = pending !== null;
  const status = input.recoveryRequired
    ? (input.statusMessage ?? "Operations stopped · manual recovery required")
    : pending === "save"
      ? "Saving…"
      : pending === "preview"
        ? "Preparing preview…"
        : pending === "publish"
          ? "Publishing…"
          : pending === "upload"
            ? "Uploading asset…"
            : input.statusMessage
              ? input.statusMessage
              : dirty
                ? canSave
                  ? "Unsaved changes · save required before publish"
                  : "Unsaved changes · Save blocked by validation"
                : !canPublish
                  ? "Saved · Publish blocked by validation"
                  : input.savedSincePublish
                    ? "Saved · unpublished changes ready to publish"
                    : "Saved · publish available";
  return {
    status,
    saveTitle: input.recoveryRequired
      ? "Manual recovery is required before editing can continue"
      : busy
        ? "Another action is in progress"
        : !dirty
          ? "No unsaved changes"
          : canSave
            ? `Save changes to the canonical ${input.collectionName}`
            : "Save is blocked by draft validation",
    previewTitle: input.recoveryRequired
      ? "Manual recovery is required before preview can continue"
      : busy
        ? "Another action is in progress"
        : canPreview
          ? dirty
            ? "Preview the current unsaved draft"
            : "Preview the saved draft"
          : "Preview is blocked by draft validation",
    publishTitle: input.recoveryRequired
      ? "Manual recovery is required before publishing can continue"
      : busy
        ? "Another action is in progress"
        : dirty
          ? "Save changes before publishing"
          : canPublish
            ? input.savedSincePublish
              ? "Publish the saved unpublished changes"
              : `Publish the saved canonical ${input.collectionName}`
            : "Publish is blocked by draft validation",
  };
}

const reloadCodes = new Set(["canonical-mismatch"]);
const reviewCodes = new Set([
  "asset-invalid-request",
  "asset-unsafe-path",
  "asset-too-large",
  "asset-unsupported-format",
  "asset-type-mismatch",
  "asset-decode-failed",
  "asset-duplicate",
  "asset-name-conflict",
  "invalid-content-id",
  "invalid-draft",
  "invalid-request",
  "preview-blocked",
  "dirty-draft",
  "publish-blocked",
  "unsafe-repository",
  "nothing-to-publish",
  "content-id-collision",
  "unsafe-journal-root",
  "unsafe-news-root",
  "unsafe-collection-root",
  "source-unavailable",
  "unresolved-references",
  "lock-conflict",
  "publish-evidence-missing",
  "publish-evidence-corrupt",
  "publish-evidence-mismatch",
  "pending-hero-publish-evidence",
]);

const reuploadCodes = new Set(["asset-temp-not-found", "asset-temp-expired"]);
const manualRecoveryCodes = new Set([
  "asset-save-rollback-failed",
  "artists-save-rollback-failed",
  "artists-create-rollback-failed",
  "journal-create-rollback-failed",
  "collection-create-rollback-failed",
  "journal-save-rollback-failed",
  "journal-rename-rollback-failed",
  "news-rename-rollback-failed",
]);

export function isEditorManualRecoveryFailure(
  code: string | undefined,
): boolean {
  return Boolean(code && manualRecoveryCodes.has(code));
}

export function editorFailureGuidance(
  code: string | undefined,
): EditorFailureGuidance {
  if (isEditorManualRecoveryFailure(code)) {
    return {
      action: "review",
      message:
        "Stop editing and request manual recovery before trying another operation.",
    };
  }
  if (code && reuploadCodes.has(code)) {
    return {
      action: "review",
      message:
        "The temporary image is no longer available. Upload it again before saving.",
    };
  }
  if (code && reloadCodes.has(code)) {
    return {
      action: "reload",
      message: "The canonical files changed. Reload before continuing.",
    };
  }
  if (code && reviewCodes.has(code)) {
    return {
      action: "review",
      message: "Review the validation details before trying again.",
    };
  }
  return {
    action: "retry",
    message: "The operation did not complete. Retry in a moment.",
  };
}

export function journalIssueLocation(issue: ContentIssue): {
  locale: "Shared" | Uppercase<Locale>;
  field: string;
} {
  const locale = issue.locale ? issue.locale.toUpperCase() : "Shared";
  const fields = issue.fieldPath ?? issue.params?.fields;
  return {
    locale: locale as "Shared" | Uppercase<Locale>,
    field: typeof fields === "string" && fields ? fields : "Source",
  };
}

export function journalIssueFieldName(issue: ContentIssue): string | null {
  const scope = issue.locale ?? "shared";
  const candidate =
    issue.fieldPath ?? issue.recovery?.fieldPath ?? issue.params?.fields;
  if (typeof candidate !== "string") return null;
  const field = candidate.split(",")[0]?.trim();
  if (!field) return null;
  return `${scope}.${field === "hero.image" ? "hero.image" : field}`;
}

export function journalDraftDirtyFields(
  initial: JournalEditorDraftState,
  current: JournalEditorDraftState,
): Set<string> {
  const dirty = new Set<string>();
  const compare = (
    scope: "shared" | Locale,
    before: unknown,
    after: unknown,
  ) => {
    if (
      !before ||
      !after ||
      typeof before !== "object" ||
      typeof after !== "object" ||
      !("state" in before) ||
      !("state" in after) ||
      before.state !== "editable" ||
      after.state !== "editable" ||
      !("value" in before) ||
      !("value" in after)
    )
      return;
    const beforeValue = before.value as Record<string, unknown>;
    const afterValue = after.value as Record<string, unknown>;
    for (const key of Object.keys(afterValue)) {
      if (
        JSON.stringify(beforeValue[key]) !== JSON.stringify(afterValue[key])
      ) {
        if (scope === "shared" && key === "hero") {
          const beforeHero = beforeValue.hero as Record<string, unknown>;
          const afterHero = afterValue.hero as Record<string, unknown>;
          for (const heroKey of Object.keys(afterHero)) {
            if (
              JSON.stringify(beforeHero?.[heroKey]) !==
              JSON.stringify(afterHero[heroKey])
            )
              dirty.add(`shared.hero.${heroKey}`);
          }
        } else dirty.add(`${scope}.${key}`);
      }
    }
  };
  compare("shared", initial.shared, current.shared);
  for (const locale of ["ja", "en"] as const)
    compare(locale, initial.locales[locale], current.locales[locale]);
  return dirty;
}

export function isEditorSaveShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    event.key.toLowerCase() === "s" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey
  );
}
