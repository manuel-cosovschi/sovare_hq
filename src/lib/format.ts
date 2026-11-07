import { formatDistanceToNowStrict, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = iso.length === 10 ? parseISO(iso + "T12:00:00") : parseISO(iso);
    return `hace ${formatDistanceToNowStrict(d, { locale: es })}`.replace("hace en ", "en ");
  } catch {
    return iso;
  }
}

export function fmtDate(iso: string | null | undefined, pattern = "d MMM yyyy"): string {
  if (!iso) return "—";
  try {
    return format(iso.length === 10 ? parseISO(iso + "T12:00:00") : parseISO(iso), pattern, { locale: es });
  } catch {
    return iso;
  }
}

export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || !isFinite(n) ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);

export const fmtCompact = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const fmtPct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined || !isFinite(n) ? "—" : `${n.toFixed(digits).replace(".", ",")}%`);
