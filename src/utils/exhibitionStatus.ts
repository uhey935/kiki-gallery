export type ExhibitionStatus = "ongoing" | "upcoming" | "past";

export function getExhibitionStatus(
  date: string,
  end_date?: string
): ExhibitionStatus {
  const now = new Date();

  const start = new Date(date + "T00:00:00");
  const end = end_date
    ? new Date(end_date + "T23:59:59")
    : start;

  if (start > now) return "upcoming";
  if (end >= now) return "ongoing";
  return "past";
}