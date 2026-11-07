import * as React from "react";
import { FileUp, Undo2 } from "lucide-react";
import { Badge, Button, Dialog, Field, Select } from "@/components/ui/primitives";
import { useAction, useData } from "@/app/hooks";
import { useApp } from "@/app/AppContext";
import { useProjects } from "@/app/queries";
import { pickTextFile } from "@/platform/files";
import { buildDrafts, detectMapping, parseCsv, FIELD_LABEL, type DateOrder, type FieldKey, type Mapping, type ParsedCsv } from "@/domain/csvImport";
import { importDrafts, listImportBatches, undoImport } from "@/repos/finance";
import { TX_KIND_LABEL } from "@/domain/types";
import { formatMoney } from "@/domain/money";
import { uid } from "@/lib/util";
import { fmtDate } from "@/lib/format";

export function CsvImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const projects = useProjects();
  const batches = useData(["import-batches"], listImportBatches, { enabled: open });
  const [file, setFile] = React.useState<{ name: string; parsed: ParsedCsv } | null>(null);
  const [mapping, setMapping] = React.useState<Mapping>({});
  const [currency, setCurrency] = React.useState(app.reportingCurrency);
  const [order, setOrder] = React.useState<DateOrder>("dmy");
  const [projectId, setProjectId] = React.useState("");

  React.useEffect(() => {
    if (!open) setFile(null);
  }, [open]);

  const pick = async () => {
    const f = await pickTextFile(["csv", "tsv", "txt"]);
    if (!f) return;
    const parsed = parseCsv(f.content);
    setFile({ name: f.name, parsed });
    setMapping(detectMapping(parsed.headers));
  };

  const lookup = React.useCallback((name: string) => projects.data?.find((p) => p.name.toLowerCase() === name.toLowerCase() || p.slug === name.toLowerCase())?.id ?? null, [projects.data]);
  const preview = React.useMemo(
    () => (file ? buildDrafts(file.parsed.rows, { mapping, defaultCurrency: currency, dateOrder: order, projectId: projectId || null, projectLookup: lookup, batchId: "preview" }) : null),
    [file, mapping, currency, order, projectId, lookup],
  );

  const run = useAction(
    async () => {
      const batch = uid();
      const p = buildDrafts(file!.parsed.rows, { mapping, defaultCurrency: currency, dateOrder: order, projectId: projectId || null, projectLookup: lookup, batchId: batch });
      return importDrafts(p.drafts, "csv", batch);
    },
    { success: (r) => `${r.inserted} transacciones importadas · ${r.duplicates} duplicadas omitidas` },
  );
  const undo = useAction((b: string) => undoImport(b), { success: (n) => `${n} transacciones revertidas (quedan en el historial de auditoría)` });

  const canImport = !!preview?.drafts.length && !!mapping.date && (!!mapping.amount || !!mapping.credit || !!mapping.debit);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Importar transacciones desde CSV"
      description="Bancos, Mercado Pago, Stripe o planillas. Reimportar el mismo archivo no duplica registros."
      width={880}
      footer={
        <>
          <Button onClick={onClose}>Cerrar</Button>
          {file && (
            <Button variant="primary" disabled={!canImport} loading={run.pending} onClick={async () => { await run.run(); setFile(null); }}>
              Importar {preview?.drafts.length ?? 0} filas
            </Button>
          )}
        </>
      }
    >
      {!file ? (
        <div className="space-y-4 pb-4">
          <button onClick={() => void pick()} className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-10 text-center transition-colors hover:bg-surface-2">
            <FileUp className="size-6 text-ink-3" />
            <span className="text-[13.5px] font-medium">Elegir archivo CSV</span>
            <span className="text-[12px] text-ink-3">Columnas mínimas: fecha e importe (o crédito/débito). Montos negativos se importan como gastos.</span>
          </button>
          {!!batches.data?.length && (
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-ink-2">Importaciones recientes</p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {batches.data.map((b) => (
                  <li key={b.import_batch_id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                    <span className="flex-1">{b.n} transacciones · {b.source} · {fmtDate(b.created_at)}</span>
                    <Button size="xs" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => void undo.run(b.import_batch_id)}>Deshacer</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4 pb-4">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <Badge tone="info">{file.name}</Badge>
            <span className="text-ink-3">{file.parsed.rows.length} filas · {file.parsed.headers.length} columnas</span>
            <Button size="xs" variant="ghost" onClick={() => void pick()}>Cambiar archivo</Button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {(Object.keys(FIELD_LABEL) as FieldKey[]).map((k) => (
              <Field key={k} label={FIELD_LABEL[k] + (k === "date" ? " *" : "")}>
                <Select value={mapping[k] ?? ""} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value || undefined })}>
                  <option value="">—</option>
                  {file.parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Moneda por defecto" hint="Se usa si el archivo no tiene columna de moneda">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}><option>USD</option><option>ARS</option></Select>
            </Field>
            <Field label="Formato de fecha">
              <Select value={order} onChange={(e) => setOrder(e.target.value as DateOrder)}>
                <option value="dmy">DD/MM/AAAA</option>
                <option value="mdy">MM/DD/AAAA</option>
                <option value="ymd">AAAA-MM-DD</option>
              </Select>
            </Field>
            <Field label="Proyecto por defecto">
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Sin proyecto</option>
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
          {preview && (
            <>
              <div className="flex gap-2 text-[12px]">
                <Badge tone="success">{preview.drafts.length} válidas</Badge>
                {preview.invalid.length > 0 && <Badge tone="danger">{preview.invalid.length} inválidas</Badge>}
                {preview.duplicatesInFile > 0 && <Badge tone="warning">{preview.duplicatesInFile} duplicadas en el archivo</Badge>}
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border border-line">
                <table className="tbl">
                  <thead><tr><th>Fila</th><th>Fecha</th><th>Tipo</th><th>Descripción</th><th className="text-right">Importe</th></tr></thead>
                  <tbody>
                    {preview.drafts.slice(0, 50).map((d) => (
                      <tr key={d.row}>
                        <td className="text-ink-3">{d.row}</td>
                        <td>{d.occurred_on}</td>
                        <td>{TX_KIND_LABEL[d.kind]}</td>
                        <td className="max-w-72 truncate">{d.description}</td>
                        <td className="text-right tabular">{formatMoney(d.amount_minor, d.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.invalid.length > 0 && <p className="text-[12px] text-danger">{preview.invalid.slice(0, 6).map((i) => `Fila ${i.row}: ${i.reason}`).join(" · ")}</p>}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
