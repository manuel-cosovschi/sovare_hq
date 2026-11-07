/**
 * Money rules:
 *  - Amounts are stored as integer minor units with their ORIGINAL currency.
 *  - Different currencies are never added together. Aggregations return a MoneyBag (per currency).
 *  - Conversions are explicit, use a recorded exchange rate (source + date) and report which rates were used.
 */
export const SUPPORTED_CURRENCIES = ["USD", "ARS"] as const;
export type Currency = string; // ISO 4217; UI supports SUPPORTED_CURRENCIES, imports may bring others.

export const CURRENCY_META: Record<string, { decimals: number; name: string; locale: string }> = {
  USD: { decimals: 2, name: "Dólar estadounidense", locale: "en-US" },
  ARS: { decimals: 2, name: "Peso argentino", locale: "es-AR" },
  EUR: { decimals: 2, name: "Euro", locale: "es-ES" },
  BRL: { decimals: 2, name: "Real", locale: "pt-BR" },
};

const decimalsOf = (c: Currency) => CURRENCY_META[c]?.decimals ?? 2;

export type MoneyBag = Record<Currency, number>;

export function toMinor(amount: number, currency: Currency): number {
  return Math.round(amount * 10 ** decimalsOf(currency));
}

export function fromMinor(minor: number, currency: Currency): number {
  return minor / 10 ** decimalsOf(currency);
}

/**
 * Parses user/CSV amounts: "1.234,56", "1,234.56", "-45", "$ 1.500", "USD 20.5", "(30,00)".
 * Returns NaN when not parseable.
 */
export function parseAmount(input: string | number): number {
  if (typeof input === "number") return input;
  let s = input.trim();
  if (!s) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[A-Za-z$€\s]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // the right-most separator is the decimal one
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    const commas = (s.match(/,/g) || []).length;
    s = commas === 1 && decimals !== 3 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot > -1) {
    const dots = (s.match(/\./g) || []).length;
    const decimals = s.length - lastDot - 1;
    // "1.500" = 1500 (es-AR thousands), but "0.500" = 0.5: a leading zero can't start a thousands group
    if (dots > 1 || (decimals === 3 && dots === 1 && s.length > 4 && !s.startsWith("0."))) s = s.replace(/\./g, "");
  }
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return NaN;
  const n = Number(s);
  return negative ? -n : n;
}

export function formatMoney(minor: number, currency: Currency, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const meta = CURRENCY_META[currency];
  const value = fromMinor(minor, currency);
  const fmt = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    notation: opts.compact && Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? (Math.abs(value) >= 10_000 ? 1 : 0) : meta?.decimals ?? 2,
    minimumFractionDigits: opts.compact ? 0 : meta?.decimals ?? 2,
    signDisplay: opts.sign ? "exceptZero" : "auto",
  });
  return fmt.format(value).replace(/\u00a0/g, " ");
}

export function addToBag(bag: MoneyBag, currency: Currency, minor: number): MoneyBag {
  bag[currency] = (bag[currency] ?? 0) + minor;
  return bag;
}

export function bagCurrencies(...bags: MoneyBag[]): Currency[] {
  const s = new Set<Currency>();
  for (const b of bags) for (const k of Object.keys(b)) s.add(k);
  return [...s].sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
}

export function bagIsEmpty(bag: MoneyBag): boolean {
  return Object.values(bag).every((v) => v === 0);
}

export interface RateLike {
  base: Currency;
  quote: Currency;
  rate: number;
  as_of: string;
  source: string;
}

export interface RateUsed {
  from: Currency;
  to: Currency;
  rate: number;
  as_of: string;
  source: string;
  inverted: boolean;
}

/** Finds the most recent rate on or before `onDate` (or the oldest available after it as fallback). */
export function findRate(rates: RateLike[], from: Currency, to: Currency, onDate?: string): RateUsed | null {
  if (from === to) return { from, to, rate: 1, as_of: onDate ?? "", source: "identity", inverted: false };
  const candidates: RateUsed[] = [];
  for (const r of rates) {
    if (r.base === from && r.quote === to) candidates.push({ from, to, rate: r.rate, as_of: r.as_of, source: r.source, inverted: false });
    else if (r.base === to && r.quote === from) candidates.push({ from, to, rate: 1 / r.rate, as_of: r.as_of, source: r.source, inverted: true });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.as_of.localeCompare(a.as_of));
  if (!onDate) return candidates[0];
  return candidates.find((c) => c.as_of <= onDate) ?? candidates[candidates.length - 1];
}

export interface Converted {
  currency: Currency;
  total: number; // minor units in target currency
  missing: Currency[]; // currencies that could not be converted (excluded from total)
  ratesUsed: RateUsed[];
}

export function convertBag(bag: MoneyBag, target: Currency, rates: RateLike[], onDate?: string): Converted {
  let total = 0;
  const missing: Currency[] = [];
  const ratesUsed: RateUsed[] = [];
  for (const [cur, minor] of Object.entries(bag)) {
    if (!minor) continue;
    const r = findRate(rates, cur, target, onDate);
    if (!r) {
      missing.push(cur);
      continue;
    }
    if (cur !== target) ratesUsed.push(r);
    const major = fromMinor(minor, cur) * r.rate;
    total += toMinor(major, target);
  }
  return { currency: target, total, missing, ratesUsed };
}
