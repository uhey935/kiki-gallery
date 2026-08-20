import type { ArtistsEditorDraftState } from "./artists-draft-state.ts";
import type { ExhibitionsEditorDraftState } from "./exhibitions-draft-state.ts";
import type { NewsEditorDraftState } from "./news-draft-state.ts";
import type { WorksEditorDraftState } from "./works-draft-state.ts";

export const createNewWorksDraft = (): WorksEditorDraftState => ({
  contentId: "",
  data: {
    artist: { id: "", collection: "artists" },
    images: [{ src: "", alt: "" }],
    inquiry: { type: "none" },
    title: "",
  },
  body: "",
  sourceRaw: "",
});

export const createNewArtistsDraft = (): ArtistsEditorDraftState => ({
  contentId: "",
  shared: {
    state: "editable",
    value: { sort_name: "", hero: { image: "" }, medium: [] },
  },
  locales: {
    ja: {
      state: "editable",
      value: {
        name: "",
        medium_label: "",
        short_bio: "",
        hero_alt: "",
        body: "",
      },
    },
    en: {
      state: "editable",
      value: {
        name: "__TODO_EN_NAME__",
        medium_label: "__TODO_EN_MEDIUM_LABEL__",
        short_bio: "__TODO_EN_SHORT_BIO__",
        hero_alt: "__TODO_EN_HERO_ALT__",
        body: "",
      },
    },
  },
  data: {
    hero: { image: "" },
    name: "",
    medium_label: "",
    short_bio: "",
    medium: [],
    hero_alt: "",
  },
  body: "",
});

export const createNewExhibitionsDraft = (): ExhibitionsEditorDraftState => ({
  contentId: "",
  shared: {
    state: "editable",
    value: {
      artists: [],
      hero: { image: "", orientation: "portrait" },
      start_date: "",
      end_date: "",
    },
  },
  locales: {
    ja: { state: "editable", value: { title: "", hero_alt: "", body: "" } },
    en: {
      state: "editable",
      value: {
        title: "__TODO_EN_TITLE__",
        hero_alt: "__TODO_EN_HERO_ALT__",
        body: "",
      },
    },
  },
});

export const createNewNewsDraft = (): NewsEditorDraftState => ({
  contentId: "",
  shared: {
    state: "editable",
    value: { date: "", news_type: "general", show_on_home: false },
  },
  locales: {
    ja: { state: "editable", value: { title: "", body: "" } },
    en: {
      state: "editable",
      value: {
        title: "__TODO_EN_TITLE__",
        summary: "__TODO_EN_SUMMARY__",
        body: "",
      },
    },
  },
  data: {
    date: "",
    news_type: "general",
    title: "",
    show_on_home: false,
  },
});
