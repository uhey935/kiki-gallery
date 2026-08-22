export type JournalMetadataModel = {
  title: string;
  description: string;
};

export function createJournalMetadataModel(localized: {
  title: string;
  summary: string;
  seo_title?: string;
  description?: string;
}): JournalMetadataModel {
  return {
    title: localized.seo_title ?? localized.title,
    description: localized.description ?? localized.summary,
  };
}
