// Local-calendar date as YYYY-MM-DD (unlike toISOString(), which returns the
// UTC date and is a day ahead after ~5 PM Pacific).
export function localDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
