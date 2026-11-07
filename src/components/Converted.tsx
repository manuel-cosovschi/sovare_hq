import { convertBag, formatMoney, type MoneyBag } from "@/domain/money";
import { useApp } from "@/app/AppContext";
import { useRates } from "@/app/queries";
import { Tip } from "./ui/primitives";
import { fmtDate } from "@/lib/format";

/** Optional consolidated view: explicit conversion with the rate's source and date. */
export function ConvertedTotal({ bag, label = "≈" }: { bag: MoneyBag; label?: string }) {
  const app = useApp();
  const rates = useRates();
  const currencies = Object.keys(bag).filter((c) => bag[c]);
  if (currencies.length < 2 || !rates.data) return null;
  const c = convertBag(bag, app.reportingCurrency, rates.data);
  if (c.missing.length)
    return (
      <Tip content={`No hay tipo de cambio registrado para ${c.missing.join(", ")} → ${app.reportingCurrency}. Cargalo en Finance → Tipos de cambio.`}>
        <span className="text-[11px] text-ink-3">sin tipo de cambio para consolidar</span>
      </Tip>
    );
  return (
    <Tip content={<div className="space-y-0.5">{c.ratesUsed.map((r, i) => <p key={i}>1 {r.from} = {r.rate.toLocaleString("es-AR", { maximumFractionDigits: 6 })} {r.to} · {r.source} · {fmtDate(r.as_of)}</p>)}<p className="pt-1 text-ink-3">Conversión informativa: los importes se guardan en su moneda original.</p></div>}>
      <span className="cursor-help text-[11px] text-ink-3 underline decoration-dotted underline-offset-2">
        {label} {formatMoney(c.total, c.currency, { compact: true })} convertido
      </span>
    </Tip>
  );
}
