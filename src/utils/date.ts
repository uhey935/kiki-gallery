export function formatDateRangeJa(start: string, end?: string) {
  const date = new Date(start);
  const endDate = end ? new Date(end) : date;

  const sameYear = date.getFullYear() === endDate.getFullYear();

  if (sameYear) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 - ${endDate.getMonth() + 1}月${endDate.getDate()}日`;
  }

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 - ${endDate.getFullYear()}年${endDate.getMonth() + 1}月${endDate.getDate()}日`;
}