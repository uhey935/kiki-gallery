import type { AboutHours, AboutLocale } from "./schema.ts";

const labels = {
  ja: {
    mon: "月",
    tue: "火",
    wed: "水",
    thu: "木",
    fri: "金",
    sat: "土",
    sun: "日",
  },
  en: {
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun",
  },
} as const;

export function presentAboutHours(hours: AboutHours, locale: AboutLocale) {
  if (hours.status === "pending") return;
  const separator = locale === "ja" ? "・" : ", ";
  const openDays = hours.open_days
    .map((day) => labels[locale][day])
    .join(separator);
  const closedDays = hours.closed_days
    .map((day) => labels[locale][day])
    .join(separator);
  return locale === "ja"
    ? {
        label: "営業時間",
        value: `${openDays} ${hours.opens}–${hours.closes}`,
        closedLabel: "休廊日",
        closedValue: closedDays,
      }
    : {
        label: "Hours",
        value: `${openDays} ${hours.opens}–${hours.closes}`,
        closedLabel: "Closed",
        closedValue: closedDays,
      };
}
