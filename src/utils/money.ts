/**
 * Money helpers. Always compare in integer cents: the API returns floats (100032.16) and
 * the UI renders strings ("$515.50", "-$5.00", and on Bill Pay "$-3.00").
 */

export function toCents(amount: number | string): number {
  if (typeof amount === 'string') return parseMoney(amount);
  if (!Number.isFinite(amount)) throw new Error(`Not a money amount: ${amount}`);
  return Math.round(amount * 100);
}

/** Parses UI money text to cents: "$515.50" | "-$5.00" | "$-3.00" | "1,234.5". */
export function parseMoney(text: string): number {
  const trimmed = text.trim();
  const negative = trimmed.includes('-');
  const digits = trimmed.replace(/[^0-9.]/g, '');
  if (!/^\d+(\.\d+)?$/.test(digits)) throw new Error(`Cannot parse money from "${text}"`);
  const cents = Math.round(Number(digits) * 100);
  return negative ? -cents : cents;
}

/** Formats cents the way most ParaBank pages do: "$1234.50" / "-$5.00" (no thousands separator). */
export function formatMoney(cents: number): string {
  const abs = Math.abs(cents);
  const text = `$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}

/** Cents -> decimal string for form inputs / API params ("12.34"). */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
