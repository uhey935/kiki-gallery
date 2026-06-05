export const formatDateRangeJa = (start: string, end?: string) => {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : startDate;

  const startY = startDate.getFullYear();
  const startM = startDate.getMonth() + 1;
  const startD = startDate.getDate();

  const endM = endDate.getMonth() + 1;
  const endD = endDate.getDate();

  if (startD === endD && startM === endM) {
    return `${startY}年${startM}月${startD}日`;
  }

  return `${startY}年${startM}月${startD}日 - ${endM}月${endD}日`;
};

export const formatDateRangeEn = (start: string, end?: string) => {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : startDate;

  const month = startDate
    .toLocaleString("en-US", { month: "short" })
    .toUpperCase();

  const startDay = startDate.getDate();
  const endDay = endDate.getDate();
  const year = startDate.getFullYear();

  if (startDay === endDay) {
    return `${month} ${startDay}, ${year}`;
  }

  return `${month} ${startDay}–${endDay}, ${year}`;
};

const WEEKDAYS = [
  "Sun.",
  "Mon.",
  "Tue.",
  "Wed.",
  "Thu.",
  "Fri.",
  "Sat.",
];

export const getWeekday = (date: string) => {
  return WEEKDAYS[new Date(date).getDay()];
};

export const formatDateShort = (date: string) => {
  const d = new Date(date);

  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = WEEKDAYS[d.getDay()];

  return `${year}.${month}.${day}${weekday}`;
};

export const formatDateRangeShort = (start: string, end?: string) => {
  const startDate = new Date(start);

  if (!end) {
    return formatDateShort(start);
  }

  const endDate = new Date(end);

  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1;
  const startDay = startDate.getDate();
  const startWeekday = WEEKDAYS[startDate.getDay()];

  const endMonth = endDate.getMonth() + 1;
  const endDay = endDate.getDate();
  const endWeekday = WEEKDAYS[endDate.getDay()];

  if (
    startYear === endDate.getFullYear() &&
    startMonth === endMonth &&
    startDay === endDay
  ) {
    return `${startYear}.${startMonth}.${startDay}${startWeekday}`;
  }

  return `${startYear}.${startMonth}.${startDay}${startWeekday} - ${endMonth}.${endDay}${endWeekday}`;
};

const pad2 = (value: number) => String(value).padStart(2, "0");