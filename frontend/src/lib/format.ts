const plurals = new Intl.PluralRules('en');

/** "1 card", "5 cards", "0 cards". */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${plurals.select(count) === 'one' ? singular : plural}`;
}
