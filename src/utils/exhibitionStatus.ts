export type ExhibitionStatus = "ongoing" | "upcoming" | "past";

export function getExhibitionStatus(
  startDate: string,
  endDate?: string
): ExhibitionStatus {
  const now = new Date();

  const start = new Date(startDate + "T00:00:00");
  const end = endDate
    ? new Date(endDate + "T23:59:59")
    : start;

  if (start > now) return "upcoming";
  if (end >= now) return "ongoing";
  return "past";
}