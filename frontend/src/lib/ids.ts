/** A numeric id from a URL ("/groups/12"): a positive whole number, or null for anything else. */
export function parseId(text: string | undefined): number | null {
  if (!text || !/^[1-9][0-9]{0,15}$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}
