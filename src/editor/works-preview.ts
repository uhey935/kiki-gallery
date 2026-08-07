import { randomUUID } from "node:crypto";

import type { WorkData } from "../content-schemas/work.ts";
import {
  type WorksEditorDraftState,
  validateWorksEditorDraft,
} from "./works-draft-state.ts";

export type WorksPreviewModel = {
  contentId: string;
  data: WorkData;
  body: string;
};

export class WorksPreviewError extends Error {
  readonly code:
    | "invalid-request"
    | "preview-blocked"
    | "preview-not-found"
    | "preview-expired";

  constructor(message: string, code: WorksPreviewError["code"]) {
    super(message);
    this.name = "WorksPreviewError";
    this.code = code;
  }
}

export function createWorksPreviewModel(
  draft: WorksEditorDraftState,
): WorksPreviewModel {
  if (!validateWorksEditorDraft(draft).capabilities.preview) {
    throw new WorksPreviewError(
      "Works preview is blocked by draft validation",
      "preview-blocked",
    );
  }
  return {
    contentId: draft.contentId,
    data: structuredClone(draft.data),
    body: draft.body,
  };
}

type PreviewRecord = { model: WorksPreviewModel; expiresAt: number };

export class WorksPreviewStore {
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

  create(model: WorksPreviewModel): string {
    this.deleteExpired();
    const token = randomUUID();
    this.records.set(token, {
      model: structuredClone(model),
      expiresAt: this.now() + this.ttlMs,
    });
    return token;
  }

  read(token: string, contentId: string): WorksPreviewModel {
    if (!/^[0-9a-f-]{36}$/.test(token)) {
      throw new WorksPreviewError(
        "Preview state was not found",
        "preview-not-found",
      );
    }
    const record = this.records.get(token);
    if (!record) {
      throw new WorksPreviewError(
        "Preview state was not found",
        "preview-not-found",
      );
    }
    if (record.expiresAt <= this.now()) {
      this.records.delete(token);
      throw new WorksPreviewError(
        "Preview state has expired",
        "preview-expired",
      );
    }
    if (record.model.contentId !== contentId) {
      throw new WorksPreviewError(
        "Preview Content ID does not match its draft state",
        "preview-not-found",
      );
    }
    return structuredClone(record.model);
  }
}

export const worksPreviewStore = new WorksPreviewStore();
