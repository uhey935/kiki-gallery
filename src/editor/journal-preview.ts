import { randomUUID } from "node:crypto";

import type { Locale } from "../content-loaders/journal/contracts.ts";
import type {
  JournalLocalized,
  JournalShared,
} from "../content-loaders/journal/schema.ts";
import {
  type JournalEditorDraftState,
  validateJournalEditorDraft,
} from "./journal-draft-state.ts";

export type JournalPreviewModel = {
  contentId: string;
  locale: Locale;
  shared: JournalShared;
  localized: JournalLocalized;
  body: string;
};

export class JournalPreviewError extends Error {
  readonly code:
    | "invalid-request"
    | "preview-blocked"
    | "preview-not-found"
    | "preview-expired";

  constructor(message: string, code: JournalPreviewError["code"]) {
    super(message);
    this.name = "JournalPreviewError";
    this.code = code;
  }
}

export function createJournalPreviewModel(
  draft: JournalEditorDraftState,
  locale: Locale,
): JournalPreviewModel {
  if (locale !== "ja" && locale !== "en") {
    throw new JournalPreviewError("Invalid preview locale", "invalid-request");
  }
  const validation = validateJournalEditorDraft(draft);
  if (!validation.capabilities.preview[locale]) {
    throw new JournalPreviewError(
      `${locale.toUpperCase()} preview is blocked by draft validation`,
      "preview-blocked",
    );
  }
  if (draft.shared.state !== "editable") {
    throw new JournalPreviewError(
      "Shared draft source is unavailable",
      "preview-blocked",
    );
  }
  const localized = draft.locales[locale];
  if (localized.state !== "editable") {
    throw new JournalPreviewError(
      `${locale.toUpperCase()} draft source is unavailable`,
      "preview-blocked",
    );
  }
  const { body, ...localizedData } = localized.value;
  return {
    contentId: draft.contentId,
    locale,
    shared: structuredClone(draft.shared.value),
    localized: structuredClone(localizedData),
    body,
  };
}

type PreviewRecord = {
  model: JournalPreviewModel;
  expiresAt: number;
};

export class JournalPreviewStore {
  private readonly records = new Map<string, PreviewRecord>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs = 10 * 60 * 1000, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  private deleteExpired(): void {
    const now = this.now();
    for (const [token, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(token);
    }
  }

  create(model: JournalPreviewModel): string {
    this.deleteExpired();
    const token = randomUUID();
    this.records.set(token, {
      model: structuredClone(model),
      expiresAt: this.now() + this.ttlMs,
    });
    return token;
  }

  read(token: string, locale: Locale): JournalPreviewModel {
    if (!/^[0-9a-f-]{36}$/.test(token)) {
      throw new JournalPreviewError(
        "Preview state was not found",
        "preview-not-found",
      );
    }
    const record = this.records.get(token);
    if (!record) {
      throw new JournalPreviewError(
        "Preview state was not found",
        "preview-not-found",
      );
    }
    if (record.expiresAt <= this.now()) {
      this.records.delete(token);
      throw new JournalPreviewError(
        "Preview state has expired",
        "preview-expired",
      );
    }
    if (record.model.locale !== locale) {
      throw new JournalPreviewError(
        "Preview locale does not match its draft state",
        "preview-not-found",
      );
    }
    return structuredClone(record.model);
  }
}

export const journalPreviewStore = new JournalPreviewStore();
