"use client";
import { useId, useState, type FormEvent } from "react";
import { Check, Eye } from "lucide-react";
import { candidateOutcomeConfig, type CandidateOutcome } from "@/config/candidate-outcome";
import { CandidateOutcomeCard } from "@/components/visitor/CandidateOutcomeCard";
import { useAdminI18n } from "./i18n";
import { useAdminDraftGuard } from "@/lib/admin-draft-guard";

export function CandidateOutcomeEditor({
  outcome,
  disabled,
  onPublish,
  onRetract,
}: {
  outcome: CandidateOutcome | null;
  disabled: boolean;
  onPublish: (body: string) => Promise<void>;
  onRetract: () => Promise<void>;
}) {
  const { t, time, err: tErr } = useAdminI18n();
  const T = t.ui.candidateOutcome;
  const id = useId();
  const [body, setBody] = useState(outcome?.body ?? candidateOutcomeConfig.defaultBody);
  const [action, setAction] = useState<"publish" | "retract" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useAdminDraftGuard(`candidate-outcome:${id}`, body !== (outcome?.body ?? candidateOutcomeConfig.defaultBody) || action !== null);
  const busy = disabled || action !== null;
  const changed = body.trim() !== outcome?.body;

  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!body.trim()) return setError(T.required);
    setAction("publish");
    setError(null);
    try {
      await onPublish(body.trim());
    } catch (e) {
      setError(tErr(e));
    } finally {
      setAction(null);
    }
  };

  const retract = async () => {
    if (busy) return;
    setAction("retract");
    setError(null);
    try {
      await onRetract();
    } catch (e) {
      setError(tErr(e));
    } finally {
      setAction(null);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="adm-panel mb-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
        <div className="max-w-3xl">
          <h2 id={`${id}-title`} className="adm-section-title">{T.title}</h2>
          <p className="adm-help mt-2 leading-relaxed">{T.intro}</p>
        </div>
        <div className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold ${outcome ? "bg-adm-green-bg text-adm-green" : "bg-adm-subtle text-adm-ink-2"}`}>
          {outcome ? <Check aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
          {outcome ? T.published : T.draft}
        </div>
      </div>
      {outcome && <p className="mt-2 text-[12px] text-adm-ink-3">{T.publishedAt(time(outcome.publishedAt))}</p>}
      <form onSubmit={(event) => void publish(event)} aria-busy={busy} className="mt-4 grid items-start gap-5 xl:grid-cols-2">
        <div>
          <label htmlFor={`${id}-body`} className="mb-1.5 block text-[13px] font-semibold">{T.bodyLabel}</label>
          <textarea
            id={`${id}-body`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="adm-input min-h-40 resize-y leading-relaxed"
            rows={5}
            maxLength={candidateOutcomeConfig.maxBodyLength}
            required
            disabled={busy}
            aria-describedby={`${id}-hint`}
            lang="pl"
          />
          <p id={`${id}-hint`} className="adm-help mt-2 leading-relaxed">{T.hint}</p>
        </div>
        <div>
          <p id={`${id}-preview`} className="mb-2 text-[13px] font-semibold">{T.preview}</p>
          <div aria-labelledby={`${id}-preview`} lang="pl">
            <CandidateOutcomeCard title={candidateOutcomeConfig.title} body={body.trim() || "—"} live={false} />
          </div>
        </div>
        <div className="border-t border-adm-line pt-4 xl:col-span-2">
          {error && <p role="alert" className="mb-3 text-[13px] text-adm-red">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="adm-btn adm-btn-primary" disabled={busy || !body.trim() || Boolean(outcome && !changed)}>
              {action === "publish" ? T.publishing : outcome ? T.update : T.publish}
            </button>
            {outcome && <button type="button" className="adm-btn" disabled={busy} onClick={() => void retract()}>{action === "retract" ? T.retracting : T.retract}</button>}
          </div>
          {outcome && <p className="adm-help mt-2 leading-relaxed">{T.retractHint}</p>}
        </div>
      </form>
    </section>
  );
}
