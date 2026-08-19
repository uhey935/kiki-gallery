type HomeStoryCandidate = {
  date: string;
  href: string;
  image: string;
  alt: string;
  type?: string;
  title: string;
};

export function selectHomeStories(
  news: HomeStoryCandidate[],
  journal: HomeStoryCandidate[],
) {
  return [...news, ...journal]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)
    .map(({ date: _date, ...story }) => story);
}
