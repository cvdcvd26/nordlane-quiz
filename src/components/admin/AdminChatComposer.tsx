"use client";
import { useEffect, useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { inboxCopy } from "@/config/admin-inbox";
import { uploadConfig } from "@/config/settings";
import { api, type PublicFile } from "@/lib/api";
import type { QuickReplies } from "@/lib/quick-replies";
import { useAdminI18n } from "./i18n";

export function AdminChatComposer({ leadId, onSend }: { leadId: string; onSend: (body: string, files: PublicFile[]) => Promise<void> }) {
  const { lang, t, err: tErr } = useAdminI18n();
  const T = inboxCopy[lang].quick;
  const [templates, setTemplates] = useState<QuickReplies | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<QuickReplies>("/api/admin/quick-replies", { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setTemplates(value); setFailed(false); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [reload]);
  return (
    <>
      {failed ? <div className="mb-2 flex items-center gap-2 text-[12px] text-adm-ink-3">
        <span>{T.loadFailed}</span><button type="button" className="underline" onClick={() => setReload(value => value + 1)}>{T.reload}</button>
      </div> : !templates && <p role="status" className="adm-help mb-2">{T.loading}</p>}
      <Composer
        onSend={onSend} uploadUrl={`/api/admin/leads/${leadId}/uploads`}
        accept={[...uploadConfig.adminAttachmentTypes]} attachmentsEnabled maxFiles={uploadConfig.maxFilesPerMessage}
        placeholder={t.ui.lead.replyPlaceholder} text={t.chat} translateError={tErr} appearance="admin"
        quickReplies={templates ? { items: templates.replies, label: T.title, select: T.select, hint: T.hint, manage: T.manage, empty: T.empty, tooLong: T.tooLong } : undefined}
      />
    </>
  );
}
