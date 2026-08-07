export type ExistingWorksAssetDraftImage = {
  kind: "existing";
  src: string;
  alt: string;
};

export type TemporaryWorksAssetDraftImage = {
  kind: "temporary";
  token: string;
  alt: string;
};

export type WorksAssetDraftImage =
  | ExistingWorksAssetDraftImage
  | TemporaryWorksAssetDraftImage;

export type WorksAssetDraftState = {
  contentId: string;
  workspaceId: string;
  images: WorksAssetDraftImage[];
};

export function temporaryWorksAssetPreviewUrl(
  token: string,
  contentId: string,
  workspaceId: string,
): string {
  return `/editor/api/works-preview/assets/${encodeURIComponent(contentId)}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(token)}`;
}

const clone = (state: WorksAssetDraftState): WorksAssetDraftState =>
  structuredClone(state);

export function createWorksAssetDraftState(
  contentId: string,
  workspaceId: string,
  images: readonly { src: string; alt: string }[],
): WorksAssetDraftState {
  return {
    contentId,
    workspaceId,
    images: images.map(({ src, alt }) => ({ kind: "existing", src, alt })),
  };
}

export function addExistingWorksAsset(
  state: WorksAssetDraftState,
  image: { src: string; alt: string },
): WorksAssetDraftState {
  const next = clone(state);
  next.images.push({ kind: "existing", ...image });
  return next;
}

export function addTemporaryWorksAsset(
  state: WorksAssetDraftState,
  image: { token: string; alt: string },
): WorksAssetDraftState {
  const next = clone(state);
  next.images.push({ kind: "temporary", ...image });
  return next;
}

export function replaceExistingWorksAsset(
  state: WorksAssetDraftState,
  index: number,
  image: { token: string },
): WorksAssetDraftState {
  if (!Number.isInteger(index) || index < 0 || index >= state.images.length)
    throw new RangeError("Works asset Draft image index is out of range");
  if (state.images[index].kind !== "existing")
    throw new TypeError("Only an existing Works asset can be replaced");
  const next = clone(state);
  next.images[index] = {
    kind: "temporary",
    token: image.token,
    // Replacement changes shared asset identity only. Localized alt text is
    // retained unless the editor changes it explicitly.
    alt: state.images[index].alt,
  };
  return next;
}

export function reorderWorksAssetDraftImage(
  state: WorksAssetDraftState,
  from: number,
  to: number,
): WorksAssetDraftState {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= state.images.length ||
    to >= state.images.length
  )
    throw new RangeError("Works asset Draft image index is out of range");
  const next = clone(state);
  const [image] = next.images.splice(from, 1);
  next.images.splice(to, 0, image);
  return next;
}

export function updateWorksAssetDraftAlt(
  state: WorksAssetDraftState,
  index: number,
  alt: string,
): WorksAssetDraftState {
  if (!Number.isInteger(index) || index < 0 || index >= state.images.length)
    throw new RangeError("Works asset Draft image index is out of range");
  const next = clone(state);
  next.images[index].alt = alt;
  return next;
}

export function removeTemporaryWorksAssetFromDraft(
  state: WorksAssetDraftState,
  token: string,
): WorksAssetDraftState {
  const next = clone(state);
  next.images = next.images.filter(
    (image) => image.kind !== "temporary" || image.token !== token,
  );
  return next;
}
