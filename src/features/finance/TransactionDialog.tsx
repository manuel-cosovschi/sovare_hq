import * as React from "react";
import { Paperclip, X } from "lucide-react";
import { Button, Dialog, Field, Input, Select, Segmented, Textarea } from "@/components/ui/primitives";
import { useApp } from "@/app/AppContext";
import { useAction } from "@/app/hooks";
import { useProjects } from "@/app/queries";
import { categoriesFor } from "@/domain/categories";
import { fromMinor, parseAmount, SUPPORTED_CURRENCIES, toMinor } from "@/domain/money";
import { TX_KIND_LABEL, type Transaction, type TxKind } from "@/domain/types";
import { createTransaction, updateTransaction } from "@/repos/finance";
import { attachFile, openAttachment } from "@/platform/files";
import { todayStr } from "@/lib/util";

export function TransactionDialog({ open, onClose, kind: initialKind = "expense", tx, preset }: { open: boolean; onClose: () => void; kind?: TxKind; tx?: Transaction | null; preset?: { project_id?: string } }) {
  const app = useApp();
  const projects = useProjects();
  const [kind, setKind] = React.useState<TxKind>(tx?.kind ?? initialKind);
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState(app.reportingCurrency);
  const [date, setDate] = React.useState(todayStr());
  const [projectId, setProjectId] = React.useState<string>("");
  const [category, setCategory] = React.useState("other");
  const [description, setDescription] = React.useState("");
  const [counterparty, setCounterparty] = React.useState("");
  const [status, setStatus] = React.useState<"cleared" | "pending">("cleared");
  const [notes, setNotes] = React.useState("");
  const [attachment, setAttachment] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setKind(tx?.kind ?? initialKind);
    setAmount(tx ? String(fromMinor(tx.amount_minor, tx.currency)).replace(".", ",") : "");
    setCurrency(tx?.currency ?? app.reportingCurrency);
    setDate(tx?.occurred_on ?? todayStr());
    setProjectId(tx?.project_id ?? preset?.project_id ?? "");
    setCategory(tx?.category ?? (initialKind === "income" ? "sales" : "other"));
    setDescription(tx?.description ?? "");
    setCounterparty(tx?.counterparty ?? "");
    setStatus(tx?.status ?? "cleared");
    setNotes(tx?.notes ?? "");
    setAttachment(tx?.attachment ?? null);
  }, [open, tx, initialKind, preset?.project_id, app.reportingCurrency]);

  const cats = categoriesFor(kind);
  React.useEffect(() => {
    if (!cats.some((c) => c.id === category)) setCategory(cats[0]?.id ?? "other");
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useAction(
    async () => {
      const n = parseAmount(amount);
      if (!isFinite(n) || n <= 0) throw new Error("Ingresá un importe positivo válido (p. ej. 1.250,50)");
      const input = { kind, category, amount_minor: toMinor(n, currency), currency, occurred_on: date, project_id: projectId || null, description: description || null, counterparty: counterparty || null, status, notes: notes || null, attachment };
      if (tx) await updateTransaction(tx.id, input);
      else await createTransaction(input);
    },
    { success: tx ? "Transacción actualizada" : `${TX_KIND_LABEL[kind]} registrado` },
  );

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const n = parseAmount(amount);
    if (!isFinite(n) || n <= 0) return setError("Ingresá un importe positivo válido (p. ej. 1.250,50)");
    await save.run();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={tx ? "Editar transacción" : "Registrar movimiento"}
      description={tx ? "Las correcciones quedan registradas en el historial de auditoría." : "Ingresos, gastos, comisiones, reembolsos e inversión se guardan en su moneda original."}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.pending} onClick={() => void submit()}>
            {tx ? "Guardar cambios" : "Registrar"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3.5 pb-2">
        <Segmented<TxKind> value={kind} onChange={setKind} options={(["income", "expense", "fee", "refund", "investment"] as TxKind[]).map((k) => ({ value: k, label: TX_KIND_LABEL[k] }))} />
        <div className="grid grid-cols-[1fr_110px_150px] gap-3">
          <Field label="Importe" error={error}>
            <Input autoFocus inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => (setAmount(e.target.value), setError(null))} className="tabular text-[15px] font-medium" />
          </Field>
          <Field label="Moneda">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
              {!SUPPORTED_CURRENCIES.includes(currency as "USD") && <option>{currency}</option>}
            </Select>
          </Field>
          <Field label="Fecha">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Proyecto">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Sin proyecto (general)</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Categoría">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Descripción">
            <Input placeholder={kind === "expense" ? "p. ej. Vercel Pro" : "p. ej. Plan anual cliente X"} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label={kind === "income" ? "Cliente" : "Proveedor / contraparte"}>
            <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          </Field>
        </div>
        <div className="flex items-end justify-between gap-3">
          <Field label="Estado" hint={status === "pending" ? "Pendiente: cuenta en facturación pero no en flujo de caja." : "Cobrado / pagado: impacta el flujo de caja."}>
            <Segmented value={status} onChange={setStatus} size="sm" options={[{ value: "cleared", label: kind === "income" ? "Cobrado" : "Pagado" }, { value: "pending", label: "Pendiente" }]} />
          </Field>
          <div className="flex items-center gap-1.5">
            {attachment ? (
              <>
                <Button size="sm" variant="subtle" icon={<Paperclip className="size-3.5" />} onClick={() => void openAttachment(attachment)}>
                  Comprobante
                </Button>
                <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} aria-label="Quitar comprobante" onClick={() => setAttachment(null)} />
              </>
            ) : (
              <Button size="sm" icon={<Paperclip className="size-3.5" />} onClick={async () => setAttachment((await attachFile())?.name ?? null)}>
                Adjuntar comprobante
              </Button>
            )}
          </div>
        </div>
        <Field label="Notas">
          <Textarea rows={2} className="min-h-14" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
