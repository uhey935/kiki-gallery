export function formatDateRangeJa(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);

  const sameYear = startDate.getFullYear() === endDate.getFullYear();

  if (sameYear) {
    return `${startDate.getFullYear()}年${startDate.getMonth() + 1}月${startDate.getDate()}日 - ${endDate.getMonth() + 1}月${endDate.getDate()}日`;
  }

  return `${startDate.getFullYear()}年${startDate.getMonth() + 1}月${startDate.getDate()}日 - ${endDate.getFullYear()}年${endDate.getMonth() + 1}月${endDate.getDate()}日`;
}