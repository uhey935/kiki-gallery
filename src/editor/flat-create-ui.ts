import {
  validateArtistsEditorDraft,
  type ArtistsEditorDraftState,
} from "./artists-draft-state.ts";
import {
  normalizeExhibitionDateInput,
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

type Collection = "works" | "artists" | "exhibitions" | "news";
type Draft =
  | WorksEditorDraftState
  | ArtistsEditorDraftState
  | ExhibitionsEditorDraftState
  | NewsEditorDraftState;

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
      body: value("body"),
      data: {
        ...current.data,
        name: value("name"),
        display_name: optional(value("display_name")),
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
    const display = value("display_artists");
    return {
      ...current,
      contentId,
      body: value("body"),
      data: {
        ...current.data,
        artists: lines(value("artists")).map((id) => ({
          id,
          collection: "artists" as const,
        })),
        works: lines(value("works")).map((id) => ({
          id,
          collection: "works" as const,
        })),
        start_date: normalizeExhibitionDateInput(value("start_date")),
        end_date: normalizeExhibitionDateInput(value("end_date")),
        display_artists: display === "default" ? undefined : display === "true",
        hero: {
          image: value("hero.image"),
          orientation: value("hero.orientation") as "portrait" | "landscape",
          position: optional(value("hero.position")) as never,
          treatment: optional(value("hero.treatment")) as never,
          hero_caption: optional(value("hero.hero_caption")),
        },
        hero_alt: value("hero_alt"),
        title: optional(value("title")),
        summary: optional(value("summary")),
        venue: optional(value("venue")),
        opening_hours: optional(value("opening_hours")),
        closed_days: optional(value("closed_days")),
        attendance: optional(value("attendance")),
      },
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
      draft = readDraft(collection, form, draft);
      inputError = undefined;
      statusMessage = undefined;
    } catch {
      inputError = "Invalid structured field input";
      draft = { ...draft, contentId: contentId.value };
    }
    render();
  };
  document.addEventListener("input", read);
  document.addEventListener("change", read);
  const request = async (url: string) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft }),
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
      const result = await request(`/editor/api/${collection}-preview/create`);
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
