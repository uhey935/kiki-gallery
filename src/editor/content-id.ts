export const contentIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isContentId(value: string): boolean {
  return contentIdPattern.test(value);
}
