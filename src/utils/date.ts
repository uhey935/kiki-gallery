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

  const month = startDate.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const startDay = startDate.getDate();
  const endDay = endDate.getDate();
  const year = startDate.getFullYear();

  if (startDay === endDay) {
    return `${month} ${startDay}, ${year}`;
  }

  return `${month} ${startDay}–${endDay}, ${year}`;
};