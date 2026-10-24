"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { revisionConfig, type TaskRevision } from "@/config/task-revisions";
import { api, ApiError, type PublicFile } from "@/lib/api";
import type { UploadItem } from "./Uploader";
import { RevisionUploader } from "./RevisionUploader";

type VisitorRevision = { revision: TaskRevision | null; files: PublicFile[] };

function RevisionResponseForm({ revision, files, onSubmitted, onReload }: {
  revision: TaskRevision; files: PublicFile[]; onSubmitted: (revision: TaskRevision) => void; onReload: () => void;
}) {
  const key = `nl_revision_draft_${revision.id}`;
  const [body, setBody] = useState(() => { try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; } });
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const changeBody = (value: string) => { setBody(value); try { sessionStorage.setItem(key, value); } catch {} };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    if (items.some(item => item.status !== "done")) { setError("Poczekaj na przesłanie plików, ponów błędne pliki lub usuń je."); return; }
    const fileIds = items.flatMap(item => item.serverId ? [item.serverId] : []);
    if (!body.trim() && !fileIds.length) { setError("Dodaj poprawiony tekst lub co najmniej jeden zrzut ekranu."); return; }
    sending.current = true; setBusy(true); setError(null);
    try {
      const result = await api<{ revision: TaskRevision }>("/api/task-revisions", { method: "POST", json: { revisionId: revision.id, body, fileIds } });
      try { sessionStorage.removeItem(key); } catch {}
      onSubmitted(result.revision);
    } catch (error) {
      setError((error as Error).message);
      if (error instanceof ApiError && ["revision_inactive", "candidate_chat_closed"].includes(error.code ?? "")) onReload();
    } finally { sending.current = false; setBusy(false); }
  };
  return <form onSubmit={submit} className="mt-5 space-y-4">
    <div>
      <label htmlFor={`revision-body-${revision.id}`} className="text-sm font-semibold">Poprawiona odpowiedź lub komentarz</label>
      <textarea id={`revision-body-${revision.id}`} value={body} onChange={event => changeBody(event.target.value)} disabled={busy} maxLength={revisionConfig.maxResponseLength} rows={4} className="mt-2 w-full rounded-xl border border-line-strong bg-paper px-4 py-3 text-sm outline-none focus:border-paint" />
      <p className="mt-1 text-xs text-ink-soft">Możesz przesłać tekst, zrzuty ekranu lub oba te elementy.</p>
    </div>
    <RevisionUploader revisionId={revision.id} initialFiles={files} disabled={busy} onItems={setItems} />
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button type="submit" className="btn btn-primary" disabled={busy || items.some(item => item.status === "uploading")}>{busy ? "Wysyłanie…" : "Prześlij poprawę"}</button>
  </form>;
}

export function TaskRevisionPanel({ closed = false }: { closed?: boolean }) {
  const [data, setData] = useState<VisitorRevision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const reloadNow = useCallback(() => setReload(value => value + 1), []);
  useEffect(() => {
    if (closed) return;
    let disposed = false;
    let polling = false;
    const controller = new AbortController();
    const poll = async () => {
      if (polling || document.hidden) return;
      polling = true;
      try {
        const next = await api<VisitorRevision>("/api/task-revisions", { signal: controller.signal });
        if (!disposed) { setData(next); setError(null); }
      } catch (error) { if (!disposed) setError((error as Error).message); }
      finally { polling = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    document.addEventListener("visibilitychange", poll);
    return () => { disposed = true; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [closed, reload]);

  if (closed || (!data?.revision && !error)) return null;
  const revision = data?.revision;
  return <section className="glass rounded-(--radius-tile) border-paint/30 p-5 sm:p-6" aria-labelledby="revision-heading">
    <h2 id="revision-heading" className="text-lg font-semibold">{revision?.status === "submitted" ? "Poprawa została przesłana" : revision?.status === "cancelled" ? "Prośba o poprawę została anulowana" : "Prośba o poprawę zadania"}</h2>
    {revision?.status === "pending" && <>
      <p className="mt-2 text-sm text-ink-soft">Zapoznaj się z uwagami i prześlij poprawę poniżej. Twoje wcześniejsze zgłoszenie zostało zachowane.</p>
      <p className="mt-4 whitespace-pre-wrap break-words rounded-xl border border-line-strong bg-paper/50 p-4 text-sm">{revision.instructions}</p>
      <RevisionResponseForm key={revision.id} revision={revision} files={data?.files ?? []} onSubmitted={value => setData({ revision: value, files: [] })} onReload={reloadNow} />
    </>}
    {revision?.status === "submitted" && <p className="mt-2 text-sm text-ink-soft">Dziękujemy. Poprawiony tekst i załączniki są zapisane w rozmowie. Poczekaj na odpowiedź opiekuna.</p>}
    {revision?.status === "cancelled" && <p className="mt-2 text-sm text-ink-soft">Nie musisz przesyłać poprawek do tej prośby. Możesz nadal korzystać z czatu.</p>}
    {error && <div className="mt-3 text-sm"><p role="alert" className="text-danger">{error}</p><button type="button" className="btn btn-ghost mt-2" onClick={reloadNow}>Ponów</button></div>}
  </section>;
}
