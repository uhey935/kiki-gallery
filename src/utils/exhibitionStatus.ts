export type ExhibitionStatus = "ongoing" | "upcoming" | "past";

export function getExhibitionStatus(
  startDate: Date,
  endDate: Date,
): ExhibitionStatus {
  const now = new Date();

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  if (start > now) return "upcoming";
  if (end >= now) return "ongoing";

  return "past";
}
