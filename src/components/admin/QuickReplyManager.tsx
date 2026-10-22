"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { inboxCopy } from "@/config/admin-inbox";
import { QUICK_REPLY_LIMITS, quickRepliesSchema, type QuickReplies } from "@/lib/quick-replies";
import { api, ApiError, newId } from "@/lib/api";
import { ErrorState } from "./ui";
import { useAdminI18n } from "./i18n";
import { toast } from "./toast";

export default function QuickReplyManager() {
  const { lang, err: tErr } = useAdminI18n();
  const T = inboxCopy[lang].quick;
  const [data, setData] = useState<QuickReplies | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<QuickReplies>("/api/admin/quick-replies", { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setData(value); setSaved(JSON.stringify(value.replies)); setError(null);
    }).catch(error => { if (!controller.signal.aborted) setError(tErr(error)); });
    return () => controller.abort();
  }, [reload, tErr]);

  const change = (id: string, field: "title" | "body", value: string) => {
    setData(current => current && ({ ...current, replies: current.replies.map(reply => reply.id === id ? { ...reply, [field]: value } : reply) }));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!data || busy) return;
    if (!quickRepliesSchema.safeParse(data.replies).success) { setError(T.invalid); return; }
    setBusy(true); setError(null);
    try {
      const value = await api<QuickReplies>("/api/admin/quick-replies", { method: "PUT", json: data });
      setData(value); setSaved(JSON.stringify(value.replies));
      toast({ kind: "success", title: T.saved });
    } catch (error) {
      setError(error instanceof ApiError && error.code === "quick_replies_changed" ? T.changed : tErr(error));
    } finally { setBusy(false); }
  };
  const add = () => setData(current => current && current.replies.length < QUICK_REPLY_LIMITS.count
    ? { ...current, replies: [...current.replies, { id: newId(), title: "", body: "" }] } : current);

  return (
    <section id="quick-replies" className="adm-panel mt-4 scroll-mt-6" aria-labelledby="quick-replies-title">
      <div className="border-b border-adm-line px-4 py-4">
        <h2 id="quick-replies-title" className="adm-section-title">{T.title}</h2>
        <p className="adm-help mt-1.5 max-w-2xl leading-relaxed">{T.hint}</p>
      </div>
      {!data ? <div className="p-4">{error
        ? <ErrorState text={error} onRetry={() => setReload(value => value + 1)} />
        : <p role="status" className="adm-help">{T.loading}</p>}</div> : (
        <form onSubmit={save}>
          <fieldset disabled={busy} className="space-y-3 px-4 py-4">
            {data.replies.length === 0 && <p className="adm-help">{T.empty}</p>}
            {data.replies.map((reply, index) => (
              <div key={reply.id} className="rounded-lg border border-adm-line bg-adm-subtle/30 p-3">
                <div className="mb-2 flex items-center gap-3">
                  <span className="text-[12px] font-semibold text-adm-ink-3">#{index + 1}</span>
                  <button type="button" className="adm-btn adm-btn-sm adm-btn-danger ml-auto" onClick={() => setData(current => current && ({ ...current, replies: current.replies.filter(item => item.id !== reply.id) }))} aria-label={`${T.remove}: ${reply.title || index + 1}`}>
                    <Trash2 aria-hidden className="size-3.5" />{T.remove}
                  </button>
                </div>
                <label htmlFor={`quick-title-${reply.id}`} className="adm-label">{T.name}</label>
                <input id={`quick-title-${reply.id}`} className="adm-input mt-1.5 max-w-lg" value={reply.title} onChange={event => change(reply.id, "title", event.target.value)} maxLength={QUICK_REPLY_LIMITS.title} required />
                <label htmlFor={`quick-body-${reply.id}`} className="adm-label mt-3">{T.body}</label>
                <textarea id={`quick-body-${reply.id}`} lang="pl" className="adm-input mt-1.5 min-h-24" value={reply.body} onChange={event => change(reply.id, "body", event.target.value)} maxLength={QUICK_REPLY_LIMITS.body} required />
              </div>
            ))}
            <button type="button" className="adm-btn" onClick={add} disabled={data.replies.length >= QUICK_REPLY_LIMITS.count}>
              <Plus aria-hidden className="size-4" />{T.add}
            </button>
            {data.replies.length >= QUICK_REPLY_LIMITS.count && <p className="adm-help">{T.limit}</p>}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3 border-t border-adm-line bg-adm-subtle/60 px-4 py-3">
            {error && <p role="alert" className="w-full text-[13px] text-adm-red">{error}</p>}
            <button type="button" className="adm-btn" disabled={busy} onClick={() => setReload(value => value + 1)}>{T.reload}</button>
            <button type="submit" className="adm-btn adm-btn-primary ml-auto" disabled={busy || JSON.stringify(data.replies) === saved}>{busy ? T.saving : T.save}</button>
          </div>
        </form>
      )}
    </section>
  );
}
