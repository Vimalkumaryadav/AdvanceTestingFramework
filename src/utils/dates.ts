/**
 * ParaBank stores transaction dates as midnight UTC and renders them as MM-dd-yyyy in the
 * browser's local timezone. The Playwright config pins timezoneId 'UTC', so UI and API agree
 * as long as we also compute dates in UTC here.
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** MM-dd-yyyy in UTC, the format of UI tables and the API path segments. */
export function formatApiDate(date: Date | number): string {
  const d = new Date(date);
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${d.getUTCFullYear()}`;
}

/** Same as formatApiDate; named for UI assertions on table cells. */
export const formatUiDate = formatApiDate;

/**
 * Request Loan renders its date as MM-d-yyyy (day NOT zero-padded) from the
 * browser clock (UTC under our config).
 */
export function formatLoanDate(date: Date | number): string {
  const d = new Date(date);
  return `${pad(d.getUTCMonth() + 1)}-${d.getUTCDate()}-${d.getUTCFullYear()}`;
}

export function addUtcDays(date: Date | number, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function utcMonthName(date: Date | number): (typeof MONTHS)[number] {
  return MONTHS[new Date(date).getUTCMonth()];
}
