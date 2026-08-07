import type {
  TemporaryWorksAssetMetadata,
  TemporaryWorksAssetStore,
} from "./works-asset-store.ts";
import {
  admitWorksAssetUpload,
  type ExistingWorksAsset,
  type WorksAssetCandidate,
  type WorksAssetFailureCode,
} from "./works-assets.ts";
import { isContentId } from "./content-id.ts";

const WORKSPACE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export type WorksAssetUploadFailureCode =
  | "asset-invalid-request"
  | WorksAssetFailureCode;

export class WorksAssetUploadError extends Error {
  readonly code: WorksAssetUploadFailureCode;

  constructor(message: string, code: WorksAssetUploadFailureCode) {
    super(message);
    this.name = "WorksAssetUploadError";
    this.code = code;
  }
}

export async function uploadTemporaryWorksAsset(input: {
  contentId: string;
  workspaceId: string;
  candidate: WorksAssetCandidate;
  existing?: readonly ExistingWorksAsset[];
  store: TemporaryWorksAssetStore;
  contentExists: (contentId: string) => boolean | Promise<boolean>;
}): Promise<TemporaryWorksAssetMetadata> {
  if (
    !isContentId(input.contentId) ||
    !WORKSPACE_ID.test(input.workspaceId) ||
    !(await input.contentExists(input.contentId))
  )
    throw new WorksAssetUploadError(
      "The Work or workspace is invalid.",
      "asset-invalid-request",
    );
  const admission = admitWorksAssetUpload(input.candidate, input.existing);
  if (!admission.accepted)
    throw new WorksAssetUploadError(admission.reason, admission.code);
  return input.store.register(
    input.contentId,
    input.workspaceId,
    input.candidate,
    admission,
  );
}
