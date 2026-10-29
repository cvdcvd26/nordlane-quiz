"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, BellRing, CheckCheck, ClipboardPenLine } from "lucide-react";
import { revisionConfig, type TaskRevision } from "@/config/task-revisions";
import { api, ApiError, type PublicFile } from "@/lib/api";
import { bindAudioUnlock, isSoundEnabled, playChime, SOUND_PREFERENCE_EVENT, type SoundPreferenceChange } from "@/lib/sound";
import { canReplaceRevision, createRevisionNotificationTracker } from "@/lib/revision-notifications";
import { MessageText } from "../chat/MessageText";
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
      <textarea id={`revision-body-${revision.id}`} value={body} onChange={event => changeBody(event.target.value)} disabled={busy} maxLength={revisionConfig.maxResponseLength} rows={4} className="mt-2 w-full rounded-xl border border-[#f4c470]/30 bg-paper px-4 py-3 text-sm outline-none focus:border-[#f4c470]" />
      <p className="mt-1 text-xs text-ink-soft">Możesz przesłać tekst, zrzuty ekranu lub oba te elementy.</p>
    </div>
    <RevisionUploader revisionId={revision.id} initialFiles={files} disabled={busy} onItems={setItems} />
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button type="submit" className="btn border border-[#f4c470] bg-[#f4c470] text-[#2b2112] hover:bg-[#ffdda0]" disabled={busy || items.some(item => item.status === "uploading")}>{busy ? "Wysyłanie…" : "Prześlij poprawę"}</button>
  </form>;
}

export function TaskRevisionNotice({ revision }: { revision: TaskRevision | null }) {
  if (revision?.status !== "pending") return null;
  return <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#f4c470]/45 bg-[#f4c470]/10 px-4 py-4 sm:px-5">
    <BellRing aria-hidden className="size-5 shrink-0 text-[#f4c470]" />
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-[#f8d99b]">Wymaga uzupełnienia</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">Opiekun przesłał uwagi do zadania. Zapoznaj się z nimi i dodaj poprawę poniżej.</p>
    </div>
    <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#f4c470]/50 px-4 text-sm font-semibold text-[#f8d99b] transition-colors hover:bg-[#f4c470]/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f4c470]" onClick={() => {
      const panel = document.getElementById("task-revision");
      panel?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      panel?.focus({ preventScroll: true });
    }}>Przejdź do poprawy<ArrowDown aria-hidden className="size-4" /></button>
  </div>;
}

export function TaskRevisionPanel({ closed = false, onRevisionChange }: { closed?: boolean; onRevisionChange?: (revision: TaskRevision | null) => void }) {
  const [data, setData] = useState<VisitorRevision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const callback = useRef(onRevisionChange);
  useEffect(() => { callback.current = onRevisionChange; }, [onRevisionChange]);
  const soundOn = useRef(true);
  const latest = useRef<TaskRevision | null>(null);
  const tracker = useRef<ReturnType<typeof createRevisionNotificationTracker> | null>(null);
  if (tracker.current === null) tracker.current = createRevisionNotificationTracker();
  useEffect(() => {
    bindAudioUnlock();
    soundOn.current = isSoundEnabled("visitor");
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<SoundPreferenceChange>).detail;
      if (detail?.scope === "visitor") soundOn.current = detail.on;
    };
    window.addEventListener(SOUND_PREFERENCE_EVENT, sync);
    return () => window.removeEventListener(SOUND_PREFERENCE_EVENT, sync);
  }, []);
  const reloadNow = useCallback(() => setReload(value => value + 1), []);
  useEffect(() => {
    if (closed) { callback.current?.(null); return; }
    let disposed = false;
    let polling = false;
    const controller = new AbortController();
    const poll = async () => {
      if (polling || document.hidden) return;
      polling = true;
      try {
        const next = await api<VisitorRevision>("/api/task-revisions", { signal: controller.signal });
        if (!disposed) {
          if (!canReplaceRevision(latest.current, next.revision)) return;
          const notify = tracker.current!.observe(next.revision);
          if (notify && soundOn.current) playChime("revision");
          latest.current = next.revision;
          setData(next); setError(null); callback.current?.(next.revision);
        }
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
  const pending = revision?.status === "pending";
  const submitted = revision?.status === "submitted";
  return <section id="task-revision" tabIndex={-1} className={`scroll-mt-24 rounded-(--radius-tile) border p-5 outline-none sm:p-6 ${pending ? "border-[#f4c470]/55 bg-[linear-gradient(135deg,#201d15_0%,#101711_70%)] shadow-[0_8px_40px_#f4c4700a]" : submitted ? "border-paint/30 bg-surface/90" : "border-line bg-surface/90"}`} aria-labelledby="revision-heading">
    <div className="flex items-center gap-3">
      <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-full border ${pending ? "border-[#f4c470]/35 bg-[#f4c470]/10 text-[#f4c470]" : submitted ? "border-paint/30 bg-paint/10 text-paint" : "border-line text-ink-soft"}`}>
        {pending ? <ClipboardPenLine className="size-5" /> : <CheckCheck className="size-5" />}
      </span>
      <div>
        {pending && <p className="mb-1 text-[10px] font-bold tracking-[0.1em] text-[#f4c470] uppercase">Wymaga uzupełnienia</p>}
        <h2 id="revision-heading" className="text-lg font-semibold">{submitted ? "Poprawka otrzymana" : revision?.status === "cancelled" ? "Prośba o poprawę została anulowana" : "Prośba o poprawę zadania"}</h2>
      </div>
    </div>
    {revision?.status === "pending" && <>
      <p className="mt-2 text-sm text-ink-soft">Zapoznaj się z uwagami i prześlij poprawę poniżej. Twoje wcześniejsze zgłoszenie zostało zachowane.</p>
      <p className="mt-4 whitespace-pre-wrap break-words rounded-xl border border-[#f4c470]/25 bg-paper/50 p-4 text-sm"><MessageText body={revision.instructions} /></p>
      <RevisionResponseForm key={revision.id} revision={revision} files={data?.files ?? []} onSubmitted={value => { latest.current = value; setData({ revision: value, files: [] }); callback.current?.(value); }} onReload={reloadNow} />
    </>}
    {revision?.status === "submitted" && <p className="mt-2 text-sm text-ink-soft">Dziękujemy. Poprawiony tekst i załączniki są zapisane w rozmowie. Poczekaj na odpowiedź opiekuna.</p>}
    {revision?.status === "cancelled" && <p className="mt-2 text-sm text-ink-soft">Nie musisz przesyłać poprawek do tej prośby. Możesz nadal korzystać z czatu.</p>}
    {error && <div className="mt-3 text-sm"><p role="alert" className="text-danger">{error}</p><button type="button" className="btn btn-ghost mt-2" onClick={reloadNow}>Ponów</button></div>}
  </section>;
}
