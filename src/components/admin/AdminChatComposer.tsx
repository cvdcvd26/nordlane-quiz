"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";
import { Composer, type ComposerDraft } from "@/components/chat/Composer";
import { inboxCopy } from "@/config/admin-inbox";
import { uploadConfig } from "@/config/settings";
import { api, type PublicFile } from "@/lib/api";
import type { QuickReplies } from "@/lib/quick-replies";
import { normalizeRichTextContent, type RichTextDocument } from "@/lib/rich-text";
import { translationCopy, type DraftTranslation, type TranslationStatus } from "@/config/chat-translation";
import { useAdminI18n } from "./i18n";
const RichTextEditor = dynamic(() => import("./RichTextEditor"), { ssr: false });

type Props = { leadId: string; onSend: (body: string, files: PublicFile[], bodyRich?: RichTextDocument | null) => Promise<void>; onDirtyChange?: (dirty: boolean) => void };
type Preview = DraftTranslation & { files: PublicFile[]; sourceRevision: string };

export function AdminChatComposer(props: Props) {
  // Changing the selected candidate must also discard all outstanding translations.
  return <LeadComposer key={props.leadId} {...props} />;
}

function LeadComposer({ leadId, onSend, onDirtyChange }: Props) {
  const { lang, t, err: tErr } = useAdminI18n();
  const T = inboxCopy[lang].quick;
  const L = translationCopy[lang];
  const [templates, setTemplates] = useState<QuickReplies | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState<TranslationStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [statusReload, setStatusReload] = useState(0);
  const hasLoadedStatus = useRef(false);
  const [mode, setMode] = useState<"translate" | "polish">("translate");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [composerVersion, setComposerVersion] = useState(0);
  const draft = useRef<ComposerDraft | null>(null);
  const generation = useRef(0);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const sendLock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<TranslationStatus>("/api/admin/translation", { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) {
        // Preserve the pre-existing Polish composer only on the initial empty
        // load. A later outage must never reinterpret a Russian draft as direct.
        if (!hasLoadedStatus.current && value.reason === "not_configured" && !draft.current?.body.trim() && !draft.current?.files.length) setMode("polish");
        hasLoadedStatus.current = true;
        setStatus(value); setStatusFailed(false);
      }
    }).catch(() => { if (!controller.signal.aborted) setStatusFailed(true); });
    return () => controller.abort();
  }, [statusReload]);
  const draftChanged = useCallback((next: ComposerDraft) => {
    if (draft.current?.revision === next.revision) return;
    draft.current = next;
    generation.current++;
    setPreview(null);
    setTranslationError(null);
  }, []);
  const connected = status?.enabled === true;
  const translating = mode === "translate";

  const prepareOrSend = async (body: string, files: PublicFile[], bodyRich?: RichTextDocument | null) => {
    if (!translating || !body) {
      await onSend(body, files, bodyRich);
      return;
    }
    if (!connected) {
      setTranslationError(status?.reason === "limit_reached" ? L.limit : status?.reason === "not_configured" ? L.unavailable : L.statusFailed);
      return false;
    }
    const currentGeneration = generation.current;
    const sourceRevision = draft.current?.revision ?? "";
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setPreparing(true); setTranslationError(null); setPreview(null);
    try {
      const translated = await api<DraftTranslation>(`/api/admin/leads/${leadId}/translations`, {
        method: "POST", json: { kind: "draft", body, bodyRich: bodyRich ?? null }, signal: controller.signal,
      });
      if (!active.current || controller.signal.aborted || currentGeneration !== generation.current) return false;
      const value = normalizeRichTextContent(translated.body, translated.bodyRich, 4000);
      if (!value.body) throw new Error("Empty translation");
      setPreview({ ...value, files, sourceRevision });
    } catch (error) {
      if (active.current && !controller.signal.aborted && currentGeneration === generation.current) {
        const code = (error as { code?: string }).code;
        if (code === "translation_limit_reached") {
          setStatus(current => current ? { ...current, enabled: false, reason: "limit_reached" } : current);
        }
        setTranslationError(code === "translation_limit_reached" ? L.limit : L.draftFailed);
      }
    } finally {
      if (active.current && request.current === controller) setPreparing(false);
    }
    return false;
  };

  const sendPreview = async () => {
    if (!preview || sendLock.current || preview.sourceRevision !== draft.current?.revision) return;
    sendLock.current = true; setSending(true); setTranslationError(null);
    try {
      const value = normalizeRichTextContent(preview.body, preview.bodyRich, 4000);
      if (!value.body) throw new Error("Empty translation");
      await onSend(value.body, preview.files, value.bodyRich);
      if (active.current) { setPreview(null); draft.current = null; generation.current++; setComposerVersion(value => value + 1); }
    } catch {
      if (active.current) setTranslationError(L.sendFailed);
    } finally {
      sendLock.current = false;
      if (active.current) setSending(false);
    }
  };

  const selectMode = (value: typeof mode) => {
    if (preparing || sending) return;
    generation.current++; request.current?.abort(); setMode(value); setPreview(null); setTranslationError(null);
  };
  useEffect(() => {
    const controller = new AbortController();
    api<QuickReplies>("/api/admin/quick-replies", { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setTemplates(value); setFailed(false); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [reload]);
  return (
    <>
      <section aria-label={L.title} className="mb-3 rounded-lg border border-adm-line bg-adm-subtle/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-adm-ink-2"><Languages aria-hidden className="size-4 text-adm-accent" />{L.title}</p>
          {(status || statusFailed) && <div className="flex flex-wrap gap-1.5" role="group" aria-label={L.title}>
            <button type="button" className={`adm-btn px-2.5 py-1 text-[11px] ${mode === "translate" ? "adm-btn-primary" : ""}`} aria-pressed={mode === "translate"} disabled={preparing || sending} onClick={() => selectMode("translate")}>{L.russianMode}</button>
            <button type="button" className={`adm-btn px-2.5 py-1 text-[11px] ${mode === "polish" ? "adm-btn-primary" : ""}`} aria-pressed={mode === "polish"} disabled={preparing || sending} onClick={() => selectMode("polish")}>{L.polishMode}</button>
          </div>}
        </div>
        <p className="adm-help mt-2" role="status">{statusFailed ? L.statusFailed : !status ? L.loading : status.reason === "not_configured" ? L.unavailable : status.reason === "limit_reached" ? L.limit : translating ? L.russianHint : L.polishHint}</p>
        {(statusFailed || status?.reason === "limit_reached") && <button type="button" className="mt-2 text-xs font-medium text-adm-accent underline" disabled={preparing || sending} onClick={() => setStatusReload(value => value + 1)}>{L.retryStatus}</button>}
      </section>
      {failed ? <div className="mb-2 flex items-center gap-2 text-[12px] text-adm-ink-3">
        <span>{T.loadFailed}</span><button type="button" className="underline" onClick={() => setReload(value => value + 1)}>{T.reload}</button>
      </div> : !templates && <p role="status" className="adm-help mb-2">{T.loading}</p>}
      <Composer
        key={composerVersion} onSend={prepareOrSend} uploadUrl={`/api/admin/leads/${leadId}/uploads`}
        onDraftChange={draftChanged} disabled={sending || (!status && !statusFailed)}
        onDirtyChange={onDirtyChange} uiLang={lang}
        accept={[...uploadConfig.adminAttachmentTypes]} attachmentsEnabled maxFiles={uploadConfig.maxFilesPerMessage}
        placeholder={translating ? L.russianPlaceholder : L.polishPlaceholder} text={{ ...t.chat, send: translating ? (preparing ? L.preparing : L.prepare) : t.chat.send }} translateError={tErr} appearance="admin"
        quickReplies={templates ? { items: templates.replies, label: T.title, select: T.select, hint: T.hint, manage: T.manage, empty: T.empty, tooLong: T.tooLong } : undefined}
      />
      {preview && <section className="mt-3 rounded-lg border border-adm-accent/35 bg-adm-accent/5 p-3" aria-label={L.previewTitle}>
        <h3 className="text-sm font-semibold text-adm-ink">{L.previewTitle}</h3>
        <p className="adm-help mt-1 mb-3">{L.previewHint}</p>
        <div className="rounded-md border border-adm-line bg-adm-surface p-1.5">
          <RichTextEditor id={`translation-preview-${leadId}`} label={L.previewLabel} value={preview} onChange={value => setPreview(current => current ? { ...current, ...value } : null)} uiLang={lang} maxLength={4000} disabled={sending} compact onSubmit={() => { void sendPreview(); }} />
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" className="adm-btn" disabled={sending} onClick={() => setPreview(null)}>{L.cancelPreview}</button>
          <button type="button" className="adm-btn adm-btn-primary" disabled={sending || !preview.body.trim()} onClick={() => { void sendPreview(); }}>{sending ? L.sending : L.sendPolish}</button>
        </div>
      </section>}
      {translationError && <p role="alert" className="mt-2 text-[12px] text-adm-red">{translationError}</p>}
    </>
  );
}
