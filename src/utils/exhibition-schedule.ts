import {
  EXHIBITION_WEEKDAYS,
  type ExhibitionLocale,
  type ExhibitionShared,
  type ExhibitionWeekday,
} from "../content-loaders/exhibitions/schema.ts";

const weekdayLabels: Record<
  ExhibitionLocale,
  Record<ExhibitionWeekday, string>
> = {
  ja: {
    mon: "月曜",
    tue: "火曜",
    wed: "水曜",
    thu: "木曜",
    fri: "金曜",
    sat: "土曜",
    sun: "日曜",
  },
  en: {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  },
};

export function formatExhibitionOpeningHours(
  hours: NonNullable<ExhibitionShared["opening_hours"]>,
) {
  return `${hours.opens}–${hours.closes}`;
}

export function formatExhibitionClosedWeekdays(
  days: ExhibitionWeekday[],
  locale: ExhibitionLocale,
) {
  const labels = [...days]
    .sort(
      (a, b) =>
        EXHIBITION_WEEKDAYS.indexOf(a) - EXHIBITION_WEEKDAYS.indexOf(b),
    )
    .map((day) => weekdayLabels[locale][day]);
  if (locale === "ja") return labels.join("・");
  if (labels.length < 2) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}
