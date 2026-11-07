import * as React from "react";
import { FolderOpen, FolderPlus, GitBranch, Trash2, ScanSearch, Check } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, Select } from "@/components/ui/primitives";
import { useAction, useData } from "@/app/hooks";
import { useProjects } from "@/app/queries";
import { listRoots, pickRoot, removeRoot, scanRoot } from "@/platform/folders";
import { analyzeFolder, dedupeCandidates, findExisting, KNOWN_CANDIDATES, type Candidate } from "@/domain/discovery";
import { createProject, listRepositories, upsertRepository, linkRepository, updateProject } from "@/repos/projects";
import { PROJECT_STATUSES, STATUS_LABEL, TYPE_LABEL, type ProjectStatus } from "@/domain/types";
import { relTime } from "@/lib/format";
import { cx } from "@/lib/util";
import { useToast } from "@/components/ui/feedback";

export function DiscoveryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const roots = useData(["fs-roots"], listRoots, { enabled: open });
  const projects = useProjects();
  const repos = useData(["repositories"], listRepositories, { enabled: open });
  const toast = useToast();
  const [candidates, setCandidates] = React.useState<Candidate[] | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [selected, setSelected] = React.useState<Record<string, { on: boolean; status: ProjectStatus }>>({});

  const addRoot = useAction(async () => {
    const r = await pickRoot();
    return r;
  }, { success: (r) => (r ? `Carpeta autorizada: ${r.path}` : null) });
  const delRoot = useAction((id: string) => removeRoot(id), { success: "Carpeta quitada (no se borró nada del disco)" });

  const existingRefs = React.useMemo(
    () =>
      (projects.data ?? []).map((p) => ({
        projectId: p.id,
        slug: p.slug,
        localPath: p.local_path,
        canonicalKeys: (repos.data ?? []).filter((r) => r.project_id === p.id).map((r) => r.canonical_key),
      })),
    [projects.data, repos.data],
  );

  const scan = async () => {
    setScanning(true);
    try {
      const all: Candidate[] = [];
      for (const r of roots.data ?? []) all.push(...(await scanRoot(r.id)).map((e) => analyzeFolder(e)));
      const list = dedupeCandidates(all);
      setCandidates(list);
      setSelected(Object.fromEntries(list.map((c) => [c.key, { on: !findExisting(c, existingRefs), status: c.suggestedStatus }])));
    } catch (e) {
      toast.show({ title: "No se pudo escanear", body: (e as Error).message, tone: "danger" });
    } finally {
      setScanning(false);
    }
  };

  const importSel = useAction(
    async () => {
      let created = 0;
      let linked = 0;
      for (const c of candidates ?? []) {
        const sel = selected[c.key];
        if (!sel?.on) continue;
        const existing = findExisting(c, existingRefs);
        const known = KNOWN_CANDIDATES.find((k) => k.name === c.knownMatch);
        let projectId = existing;
        if (!projectId) {
          projectId = await createProject({
            name: known?.name ?? c.name,
            description: c.description ?? known?.description ?? null,
            type: known?.type ?? c.type,
            category: known?.category ?? null,
            status: sel.status,
            languages: c.languages,
            frameworks: c.frameworks,
            database_tech: c.databaseTech,
            hosting: c.hosting,
            local_path: c.paths[0],
            source: "discovery",
          });
          created++;
        } else {
          await updateProject(projectId, { local_path: c.paths[0] });
          linked++;
        }
        const key = c.canonicalRemote ?? `local:${c.paths[0]}`;
        const repoId = await upsertRepository({
          canonical_key: key,
          provider: c.canonicalRemote?.startsWith("github.com/") ? "github" : "local",
          full_name: c.canonicalRemote?.startsWith("github.com/") ? c.canonicalRemote.slice("github.com/".length) : null,
          html_url: c.canonicalRemote ? `https://${c.canonicalRemote}` : null,
          local_path: c.paths[0],
          default_branch: c.branch,
          last_commit_at: c.lastCommitAt,
          last_commit_message: c.lastCommitMsg,
          project_id: projectId,
        });
        await linkRepository(repoId, projectId);
      }
      return { created, linked };
    },
    { success: (r) => `${r.created} proyectos creados · ${r.linked} vinculados a existentes` },
  );

  const selCount = Object.values(selected).filter((s) => s.on).length;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Descubrir proyectos"
      description="Solo se leen manifests y metadatos Git dentro de las carpetas que autorices. Nada se modifica."
      width={860}
      footer={
        candidates ? (
          <>
            <span className="mr-auto text-[12px] text-ink-3">{selCount} seleccionados de {candidates.length}</span>
            <Button onClick={() => setCandidates(null)}>Volver</Button>
            <Button
              variant="primary"
              disabled={!selCount}
              loading={importSel.pending}
              onClick={async () => {
                await importSel.run();
                setCandidates(null);
                onClose();
              }}
            >
              Registrar seleccionados
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cerrar</Button>
            <Button variant="primary" icon={<ScanSearch className="size-4" />} disabled={!roots.data?.length} loading={scanning} onClick={() => void scan()}>
              Escanear carpetas
            </Button>
          </>
        )
      }
    >
      {!candidates ? (
        <div className="space-y-3 pb-3">
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] font-medium text-ink-2">Carpetas autorizadas</p>
            <Button size="sm" icon={<FolderPlus className="size-3.5" />} onClick={() => void addRoot.run()}>
              Agregar carpeta
            </Button>
          </div>
          {!roots.data?.length ? (
            <EmptyState compact icon={<FolderOpen />} title="Ninguna carpeta autorizada" body="Elegí una carpeta concreta donde guardás tus proyectos (por ejemplo ~/Developer). Sovare HQ no explora el resto de tu Mac." />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {roots.data.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                  <FolderOpen className="size-4 text-ink-3" />
                  <span className="flex-1 truncate font-mono text-[12px]">{r.path}</span>
                  <Button size="xs" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => void delRoot.run(r.id)}>
                    Quitar
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[12px] text-ink-3">Se detectan: repositorios Git (remotes, rama, último commit), package.json, Cargo.toml, pyproject, go.mod, pubspec, proyectos Xcode, Dockerfiles y configs de Vercel/Netlify/Railway/Render/Fly. Profundidad máxima: 3 niveles; se omiten node_modules, builds y carpetas ocultas.</p>
        </div>
      ) : !candidates.length ? (
        <EmptyState compact icon={<ScanSearch />} title="No se encontraron proyectos" body="No hay repositorios ni manifests en las carpetas autorizadas (hasta 3 niveles de profundidad)." />
      ) : (
        <ul className="space-y-2 pb-3">
          {candidates.map((c) => {
            const existing = findExisting(c, existingRefs);
            const s = selected[c.key];
            return (
              <li key={c.key} className={cx("rounded-xl border p-3 transition-colors", s?.on ? "border-accent/50 bg-accent-soft/40" : "border-line")}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" checked={!!s?.on} onChange={(e) => setSelected({ ...selected, [c.key]: { ...s, on: e.target.checked } })} aria-label={`Seleccionar ${c.name}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-semibold">{c.knownMatch ?? c.name}</span>
                      {c.knownMatch && c.knownMatch !== c.name && <span className="text-[12px] text-ink-3">({c.name})</span>}
                      <Badge>{TYPE_LABEL[c.type]}</Badge>
                      {c.knownMatch && <Badge tone="accent">Candidato conocido</Badge>}
                      {existing && <Badge tone="info"><Check className="size-3" />Ya registrado · se vinculará</Badge>}
                      {c.paths.length > 1 && <Badge tone="warning">{c.paths.length} copias locales del mismo repo</Badge>}
                    </div>
                    {c.description && <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-2">{c.description}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-ink-3">
                      {c.canonicalRemote && <span className="flex items-center gap-1"><GitBranch className="size-3" />{c.canonicalRemote}</span>}
                      <span className="font-mono">{c.paths[0]}</span>
                      {c.lastCommitAt && <span>último commit {relTime(c.lastCommitAt)}</span>}
                    </p>
                    <p className="mt-1 text-[11.5px] text-ink-3">
                      {[...c.languages, ...c.frameworks].join(" · ") || "Stack no identificado"}
                      {c.hosting ? ` · ${c.hosting}` : ""}
                      {c.databaseTech ? ` · ${c.databaseTech}` : ""}
                    </p>
                    <p className="mt-1 text-[11.5px] text-ink-3">Evidencia: {c.evidence.join(", ")}</p>
                  </div>
                  {!existing && (
                    <div className="w-40 shrink-0">
                      <Select value={s?.status ?? c.suggestedStatus} onChange={(e) => setSelected({ ...selected, [c.key]: { ...s, status: e.target.value as ProjectStatus } })} aria-label="Estado inicial">
                        {PROJECT_STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
                      </Select>
                      <p className="mt-1 text-[10.5px] leading-tight text-ink-3" title={c.statusReasons.join("\n")}>Sugerido: {c.statusReasons[0] ?? "sin evidencia"}</p>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
