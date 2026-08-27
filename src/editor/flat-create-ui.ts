import {
  validateArtistsEditorDraft,
  type ArtistsEditorDraftState,
} from "./artists-draft-state.ts";
import {
  validateExhibitionsEditorDraft,
  type ExhibitionsEditorDraftState,
} from "./exhibitions-draft-state.ts";
import {
  validateNewsEditorDraft,
  type NewsEditorDraftState,
} from "./news-draft-state.ts";
import { editorFailureGuidance, renderFlatValidationPanel } from "./ux.ts";
import {
  validateWorksEditorDraft,
  type WorksEditorDraftState,
} from "./works-draft-state.ts";
import type { ExhibitionWeekday } from "../content-loaders/exhibitions/schema.ts";

type Collection = "works" | "artists" | "exhibitions" | "news";
type Draft =
  | WorksEditorDraftState
  | ArtistsEditorDraftState
  | ExhibitionsEditorDraftState
  | NewsEditorDraftState;
type CreateHeroCandidate = {
  token: string;
  sha256: string;
  format: "avif" | "jpg" | "png" | "webp";
};

const optional = (value: string) => value.trim() || undefined;
const lines = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

function readDraft(
  collection: Collection,
  form: HTMLFormElement,
  draft: Draft,
) {
  const data = new FormData(form);
  const value = (name: string) => String(data.get(name) ?? "");
  const contentId = value("contentId");
  if (collection === "works") {
    const current = draft as WorksEditorDraftState;
    const inquiryType = value("inquiry.type") as "inquiry" | "shop" | "none";
    const url = optional(value("inquiry.url"));
    return {
      ...current,
      contentId,
      body: value("body"),
      data: {
        ...current.data,
        artist: { id: value("artist"), collection: "artists" as const },
        images: [{ src: value("images.0.src"), alt: value("images.0.alt") }],
        year: value("year") ? Number(value("year")) : undefined,
        size: optional(value("size")),
        orientation: optional(value("orientation")) as "landscape" | undefined,
        inquiry:
          inquiryType === "none"
            ? { type: "none" as const }
            : inquiryType === "shop"
              ? { type: "shop" as const, url: url ?? "" }
              : { type: "inquiry" as const, ...(url ? { url } : {}) },
        title: value("title"),
        material: optional(value("material")),
        seo_title: optional(value("seo_title")),
        description: optional(value("description")),
      },
    };
  }
  if (collection === "artists") {
    const current = draft as ArtistsEditorDraftState;
    const layouts = JSON.parse(value("works_layout")) as Array<{
      layout: "single-a" | "single-b" | "double-a" | "double-b";
      works: string[];
    }>;
    return {
      ...current,
      contentId,
      body: "",
      locales: {
        ...current.locales,
        en: {
          ...(current.locales.en.state === "editable"
            ? current.locales.en
            : {}),
          state: "editable" as const,
          value: {
            name: value("en.name"),
            medium_label: value("en.medium_label"),
            short_bio: value("en.short_bio"),
            biography: optional(value("en.biography")),
            hero_alt: value("en.hero_alt"),
            seo_title: optional(value("en.seo_title")),
            description: optional(value("en.description")),
            body: "",
          },
        },
      },
      data: {
        ...current.data,
        name: value("name"),
        display_name: optional(value("display_name")),
        medium_label: value("medium_label"),
        short_bio: value("short_bio"),
        biography: optional(value("biography")),
        medium: lines(value("medium")),
        hero: { image: value("hero.image") },
        hero_alt: value("hero_alt"),
        works_layout: layouts.length
          ? layouts.map((section) => ({
              layout: section.layout,
              works: section.works.map((id) => ({
                id,
                collection: "works" as const,
              })),
            }))
          : undefined,
        seo_title: optional(value("seo_title")),
        description: optional(value("description")),
      },
    };
  }
  if (collection === "exhibitions") {
    const current = draft as ExhibitionsEditorDraftState;
    const display = value("shared.display_artists");
    const opens = value("shared.opening_hours.opens");
    const closes = value("shared.opening_hours.closes");
    const closedWeekdays = data
      .getAll("shared.closed_weekdays")
      .map(String) as ExhibitionWeekday[];
    const localized = (locale: "ja" | "en") => ({
      state: "editable" as const,
      value: {
        title: value(`${locale}.title`),
        hero_alt: value(`${locale}.hero_alt`),
        body: value(`${locale}.body`),
        venue: optional(value(`${locale}.venue`)),
        attendance: optional(value(`${locale}.attendance`)),
        hero_caption: optional(value(`${locale}.hero_caption`)),
        seo_title: optional(value(`${locale}.seo_title`)),
        description: optional(value(`${locale}.description`)),
      },
    });
    return {
      ...current,
      contentId,
      shared: {
        state: "editable" as const,
        value: {
          artists: lines(value("shared.artists")),
          works: lines(value("shared.works")),
          start_date: value("shared.start_date"),
          end_date: value("shared.end_date"),
          display_artists:
            display === "default" ? undefined : display === "true",
          ...(opens || closes
            ? { opening_hours: { opens, closes } }
            : {}),
          ...(data.get("shared.closed_weekdays.known") === "on"
            ? { closed_weekdays: closedWeekdays }
            : {}),
          hero: {
            image: value("shared.hero.image"),
            orientation: value("shared.hero.orientation") as
              "portrait" | "landscape",
            position: optional(value("shared.hero.position")) as never,
            treatment: optional(value("shared.hero.treatment")) as never,
          },
        },
      },
      locales: { ja: localized("ja"), en: localized("en") },
    };
  }
  const current = draft as NewsEditorDraftState;
  const shared = {
    date: value("shared.date"),
    news_type: value(
      "shared.news_type",
    ) as NewsEditorDraftState["data"]["news_type"],
    link: optional(value("shared.link")),
    show_on_home: data.get("shared.show_on_home") === "on",
  };
  const ja = {
    title: value("ja.title"),
    summary: optional(value("ja.summary")),
    body: "",
  };
  const en = {
    title: value("en.title"),
    summary: optional(value("en.summary")),
    body: "",
  };
  return {
    ...current,
    contentId,
    shared: { state: "editable", value: shared },
    locales: {
      ja: { state: "editable", value: ja },
      en: { state: "editable", value: en },
    },
    data: {
      ...shared,
      title: ja.title,
      summary: ja.summary,
    },
  } as NewsEditorDraftState;
}

export function startFlatCreateUi(collection: Collection) {
  const raw = document.querySelector<HTMLScriptElement>(
    `#${collection}-create-draft`,
  )?.textContent;
  const form = document.querySelector<HTMLFormElement>(
    `[data-${collection}-draft-form]`,
  );
  const contentId = document.querySelector<HTMLInputElement>(
    'input[name="contentId"]',
  );
  const preview = document.querySelector<HTMLButtonElement>(
    "[data-create-preview]",
  );
  const save = document.querySelector<HTMLButtonElement>("[data-create-save]");
  const publish = document.querySelector<HTMLButtonElement>(
    "[data-create-publish]",
  );
  const status = document.querySelector<HTMLElement>(
    "[data-create-action-status]",
  );
  if (!raw || !form || !contentId || !preview || !save || !publish || !status)
    return;
  form.id = `${collection}-create-form`;
  const initial = JSON.parse(raw) as Draft;
  let draft = structuredClone(initial);
  let pending = false;
  let inputError: string | undefined;
  let statusMessage: string | undefined;
  const heroCollection = collection === "artists" || collection === "exhibitions" ? collection : undefined;
  const createWorkspaceId = heroCollection ? crypto.randomUUID() : "";
  let artistsHero: CreateHeroCandidate | undefined;
  const heroRoot = document.querySelector<HTMLElement>(
    collection === "artists" ? "[data-artists-create-hero]" : "[data-exhibitions-hero]",
  );
  const heroPath = heroRoot?.querySelector<HTMLInputElement>(
    collection === "artists" ? "[data-artists-create-hero-path]" : "[data-exhibitions-hero-path]",
  );
  const heroDrop = heroRoot?.querySelector<HTMLElement>(
    collection === "artists" ? "[data-artists-create-hero-drop]" : "[data-exhibitions-hero-drop]",
  );
  const heroCurrent = heroRoot?.querySelector<HTMLElement>(
    collection === "artists" ? "[data-artists-create-hero-current]" : "[data-exhibitions-hero-current]",
  );
  const heroFile = heroRoot?.querySelector<HTMLInputElement>(
    collection === "artists" ? "[data-artists-create-hero-file]" : "[data-exhibitions-hero-file]",
  );
  const heroThumbnail = heroRoot?.querySelector<HTMLImageElement>(
    collection === "artists" ? "[data-artists-create-hero-thumbnail]" : "[data-exhibitions-hero-thumbnail]",
  );
  const heroCanonicalPath = heroRoot?.querySelector<HTMLElement>(
    collection === "artists" ? "[data-artists-create-hero-canonical-path]" : "[data-exhibitions-hero-canonical-path]",
  );
  const heroStatus = heroRoot?.querySelector<HTMLElement>(
    collection === "artists" ? "[data-artists-create-hero-status]" : "[data-exhibitions-hero-status]",
  );
  const ownerContentId = () => `create-${createWorkspaceId}`;
  const heroPreviewUrl = (token: string) =>
    `/editor/api/${heroCollection}-hero-preview/${encodeURIComponent(ownerContentId())}/${encodeURIComponent(createWorkspaceId)}/${encodeURIComponent(token)}`;
  const releaseHero = async (candidate = artistsHero, keepalive = false) => {
    if (!candidate) return;
    await fetch(`/editor/api/${heroCollection}-hero/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: candidate.token,
        contentId: ownerContentId(),
        workspaceId: createWorkspaceId,
      }),
      keepalive,
    }).catch(() => undefined);
  };
  const syncHero = () => {
    if (!heroPath || !heroDrop || !heroCurrent) return;
    const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contentId.value);
    const proposed =
      artistsHero && validId
        ? `/images/${heroCollection}/${contentId.value}.${artistsHero.format}`
        : "";
    heroPath.value = proposed;
    heroDrop.hidden = Boolean(artistsHero);
    heroCurrent.hidden = !artistsHero;
    if (heroCanonicalPath)
      heroCanonicalPath.textContent =
        proposed || "Enter a valid Content ID to determine the canonical path";
    if (heroThumbnail && artistsHero)
      heroThumbnail.src = heroPreviewUrl(artistsHero.token);
  };
  const validate = (value: Draft) =>
    ({
      works: validateWorksEditorDraft,
      artists: validateArtistsEditorDraft,
      exhibitions: validateExhibitionsEditorDraft,
      news: validateNewsEditorDraft,
    })[collection](value as never);
  const render = (message?: string) => {
    const validation = validate(draft);
    const idValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.contentId);
    if (inputError)
      validation.issues = [
        {
          ruleId: "content.create.input",
          severity: "error",
          category: "structure",
          collection,
          contentId: draft.contentId,
          fieldPath: "form",
          messageKey: inputError,
          recovery: { kind: "edit-field", fieldPath: "form" },
        },
      ];
    const previewCapability = validation.capabilities.preview;
    const flatCapabilities = {
      ...validation.capabilities,
      preview:
        typeof previewCapability === "boolean"
          ? previewCapability
          : previewCapability.ja || previewCapability.en,
    };
    renderFlatValidationPanel(form, {
      ...validation,
      issues: validation.issues as never,
      capabilities: { ...flatCapabilities, publish: false },
    });
    const allowed = idValid && !inputError && validation.capabilities.save;
    preview.disabled = pending || !allowed;
    save.disabled = pending || !allowed;
    publish.disabled = true;
    form
      .querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input, textarea, select")
      .forEach((control) => (control.disabled = pending));
    contentId.disabled = pending;
    status.textContent =
      message ??
      statusMessage ??
      (allowed
        ? "Unsaved new entry · ready for Draft Preview or First Save"
        : !idValid
          ? "Create blocked · use a lowercase hyphenated Content ID"
          : "Create blocked by validation");
  };
  const read = () => {
    try {
      if (heroCollection) syncHero();
      draft = readDraft(collection, form, draft);
      inputError = undefined;
      statusMessage = undefined;
    } catch {
      inputError = "Invalid structured field input";
      draft = { ...draft, contentId: contentId.value };
    }
    render();
  };
  const uploadArtistsHero = async (file: File) => {
    if (!heroStatus) return;
    heroStatus.textContent = "Validating and staging image…";
    const body = new FormData();
    body.set("file", file);
    body.set("createWorkspaceId", createWorkspaceId);
    try {
      const response = await fetch(`/editor/api/${heroCollection}-hero/create-upload`, {
        method: "POST",
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Hero upload failed");
      const previous = artistsHero;
      artistsHero = {
        token: result.asset.token,
        sha256: result.asset.sha256,
        format: result.asset.format,
      };
      if (previous) await releaseHero(previous);
      syncHero();
      read();
      heroStatus.textContent = "Temporary image staged · First Save to confirm";
    } catch (error) {
      heroStatus.textContent =
        error instanceof Error ? error.message : "Hero upload failed";
    } finally {
      if (heroFile) heroFile.value = "";
    }
  };
  if (heroCollection && heroRoot && heroFile && heroDrop) {
    heroRoot
      .querySelector(collection === "artists" ? "[data-artists-create-hero-select]" : "[data-exhibitions-hero-select]")
      ?.addEventListener("click", () => heroFile.click());
    heroRoot
      .querySelector(collection === "artists" ? "[data-artists-create-hero-replace]" : "[data-exhibitions-hero-replace]")
      ?.addEventListener("click", () => heroFile.click());
    heroFile.addEventListener("change", () => {
      const file = heroFile.files?.[0];
      if (file) void uploadArtistsHero(file);
    });
    heroDrop.addEventListener("dragover", (event) => {
      event.preventDefault();
      heroDrop.classList.add("is-dragging");
    });
    heroDrop.addEventListener("dragleave", () =>
      heroDrop.classList.remove("is-dragging"),
    );
    heroDrop.addEventListener("drop", (event) => {
      event.preventDefault();
      heroDrop.classList.remove("is-dragging");
      const file = event.dataTransfer?.files[0];
      if (file) void uploadArtistsHero(file);
    });
    heroRoot
      .querySelector(collection === "artists" ? "[data-artists-create-hero-remove]" : "[data-exhibitions-hero-remove]")
      ?.addEventListener("click", () => {
        const previous = artistsHero;
        artistsHero = undefined;
        syncHero();
        read();
        void releaseHero(previous);
        if (heroStatus) heroStatus.textContent = "Temporary Hero removed";
      });
    window.addEventListener(
      "pagehide",
      () => void releaseHero(artistsHero, true),
    );
  }
  document.addEventListener("input", read);
  document.addEventListener("change", read);
  const request = async (url: string, forPreview = false) => {
    let requestDraft = draft;
    if (heroCollection && artistsHero && forPreview) {
      requestDraft = structuredClone(draft);
      if (collection === "artists") (requestDraft as ArtistsEditorDraftState).data.hero.image = heroPreviewUrl(artistsHero.token);
      else if ((requestDraft as ExhibitionsEditorDraftState).shared.state === "editable") (requestDraft as ExhibitionsEditorDraftState & { shared: { state: "editable"; value: { hero: { image: string } } } }).shared.value.hero.image = heroPreviewUrl(artistsHero.token);
    }
    const requestBody =
      heroCollection && !forPreview
        ? {
            draft: requestDraft,
            hero: artistsHero
              ? { ...artistsHero, createWorkspaceId }
              : undefined,
          }
        : collection === "exhibitions"
          ? { draft: requestDraft, locale: "ja" }
          : { draft: requestDraft };
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(result.error ?? "Create request failed"), {
        code: result.code,
      });
    return result as { url?: string; workspaceUrl?: string };
  };
  preview.addEventListener("click", async () => {
    const popup = window.open("", "_blank");
    pending = true;
    render("Preparing Draft Preview…");
    try {
      const result = await request(
        `/editor/api/${collection}-preview/create`,
        true,
      );
      if (!result.url) throw new Error("Preview URL missing");
      if (popup) popup.location.href = result.url;
      else window.open(result.url, "_blank", "noopener,noreferrer");
      statusMessage = "Draft Preview opened";
    } catch (error) {
      popup?.close();
      const value = error as Error & { code?: string };
      statusMessage = `${value.message} ${editorFailureGuidance(value.code).message}`;
    } finally {
      pending = false;
      render();
    }
  });
  save.addEventListener("click", async () => {
    pending = true;
    render("Creating canonical entry…");
    try {
      const result = await request(`/editor/api/${collection}-create`);
      if (!result.workspaceUrl) throw new Error("Workspace URL missing");
      window.location.assign(result.workspaceUrl);
    } catch (error) {
      pending = false;
      const value = error as Error & { code?: string };
      statusMessage = `${value.message} ${editorFailureGuidance(value.code).message}`;
      render();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (JSON.stringify(draft) === JSON.stringify(initial)) return;
    event.preventDefault();
    (event as unknown as { returnValue: string }).returnValue = "";
  });
  read();
}
