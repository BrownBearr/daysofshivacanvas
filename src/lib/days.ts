// Clip names are day numbers of the daily practice. Day DAY_ANCHOR was made on DATE_ANCHOR, so any
// day number maps to a calendar date and "days made" can be computed for today.
const DAY_ANCHOR = 1733;
const DATE_ANCHOR = Date.UTC(2026, 4, 25);
const MS_PER_DAY = 86_400_000;

const fmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function dateOfDay(day: number): Date {
  return new Date(DATE_ANCHOR + (day - DAY_ANCHOR) * MS_PER_DAY);
}

export function formatDay(name: string): string {
  const n = Number(name);
  return Number.isFinite(n) ? fmt.format(dateOfDay(n)) : "";
}

export function daysMadeToday(): number {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return DAY_ANCHOR + Math.max(0, Math.floor((today - DATE_ANCHOR) / MS_PER_DAY));
}
