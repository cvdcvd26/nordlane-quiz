"use client";
import { useEffect, useState } from "react";
import type { EditableSettings } from "@/config/settings";
import { api } from "@/lib/api";
import { useAdminI18n } from "@/components/admin/i18n";
import { ErrorState, PageHeader } from "@/components/admin/ui";
import { toast } from "@/components/admin/toast";

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-8 gap-y-3 border-b border-adm-line px-4 py-5 last:border-0 md:grid-cols-[240px_1fr]">
      <div>
        <h2 className="adm-section-title">{title}</h2>
        {hint && <p className="adm-help mt-1">{hint}</p>}
      </div>
      <div className="min-w-0 max-w-xl">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { t, err: tErr } = useAdminI18n();
  const S = t.ui.settings;
  const [s, setS] = useState<EditableSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", repeat: "" });
  const [pwError, setPwError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<{ settings: EditableSettings }>("/api/admin/settings")
      .then((r) => {
        setS(r.settings);
        setLoadError(null);
      })
      .catch((e) => setLoadError(tErr(e)));
  }, [tErr, reload]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!s) return;
    setFormError(null);
    if (s.autoMessageMaxDelayMinutes < s.autoMessageMinDelayMinutes) return setFormError(S.delayOrder);
    setBusy(true);
    try {
      const r = await api<{ settings: EditableSettings }>("/api/admin/settings", { method: "PUT", json: s });
      setS(r.settings);
      toast({ kind: "success", title: S.saved });
    } catch (err) {
      setFormError(tErr(err));
    } finally {
      setBusy(false);
    }
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (pw.newPassword !== pw.repeat) return setPwError(S.password.mismatch);
    try {
      await api("/api/admin/password", { method: "POST", json: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      setPw({ currentPassword: "", newPassword: "", repeat: "" });
      toast({ kind: "success", title: S.password.changed });
    } catch (err) {
      setPwError(tErr(err));
    }
  };

  return (
    <div>
      <PageHeader title={t.ui.nav.settings} description={S.description} />

      {loadError && <ErrorState text={loadError} onRetry={() => setReload((n) => n + 1)} />}
      {!s && !loadError && <div className="adm-skeleton h-80" aria-busy aria-label={t.ui.common.loading} />}

      {s && (
        <form onSubmit={save} className="adm-panel" noValidate>
          <Row title={S.sectionAuto} hint={S.intro}>
            <label className="flex items-center gap-2.5">
              <input type="checkbox" className="adm-check" checked={s.autoMessageEnabled} onChange={(e) => setS({ ...s, autoMessageEnabled: e.target.checked })} />
              <span className="text-[13.5px] font-medium">{S.enabled}</span>
            </label>
            <label className="adm-label mt-4" htmlFor="text">
              {S.text}
            </label>
            <textarea
              id="text"
              className="adm-input mt-1.5 min-h-32"
              value={s.autoMessageText}
              onChange={(e) => setS({ ...s, autoMessageText: e.target.value })}
              maxLength={4000}
            />
            <div className="mt-4 grid max-w-xs grid-cols-2 gap-3">
              <label className="adm-label">
                {S.delayFrom}
                <input
                  type="number"
                  min={0}
                  max={1440}
                  className="adm-input mt-1.5 tabular-nums"
                  value={s.autoMessageMinDelayMinutes}
                  onChange={(e) => setS({ ...s, autoMessageMinDelayMinutes: Number(e.target.value) })}
                />
              </label>
              <label className="adm-label">
                {S.delayTo}
                <input
                  type="number"
                  min={0}
                  max={1440}
                  className="adm-input mt-1.5 tabular-nums"
                  aria-invalid={s.autoMessageMaxDelayMinutes < s.autoMessageMinDelayMinutes || undefined}
                  value={s.autoMessageMaxDelayMinutes}
                  onChange={(e) => setS({ ...s, autoMessageMaxDelayMinutes: Number(e.target.value) })}
                />
              </label>
            </div>
            <p className="adm-help mt-2">{S.delayHint}</p>
          </Row>

          <Row title={S.chat}>
            <label className="flex items-center gap-2.5">
              <input type="checkbox" className="adm-check" checked={s.chatAttachmentsEnabled} onChange={(e) => setS({ ...s, chatAttachmentsEnabled: e.target.checked })} />
              <span className="text-[13.5px] font-medium">{S.attachments}</span>
            </label>
          </Row>

          <div className="flex flex-wrap items-center gap-3 border-t border-adm-line bg-adm-subtle/60 px-4 py-3">
            {formError && (
              <p role="alert" className="text-[13px] text-adm-red">
                {formError}
              </p>
            )}
            <button type="submit" className="adm-btn adm-btn-primary ml-auto" disabled={busy}>
              {busy ? S.saving : S.save}
            </button>
          </div>
        </form>
      )}

      <form onSubmit={changePw} className="adm-panel mt-4" noValidate>
        <Row title={S.password.title}>
          <div className="max-w-sm space-y-3">
            {(
              [
                ["currentPassword", S.password.current, "current-password"],
                ["newPassword", S.password.next, "new-password"],
                ["repeat", S.password.repeat, "new-password"],
              ] as const
            ).map(([key, label, ac]) => (
              <label key={key} className="adm-label">
                {label}
                <input type="password" autoComplete={ac} className="adm-input mt-1.5" value={pw[key]} onChange={(e) => setPw({ ...pw, [key]: e.target.value })} />
              </label>
            ))}
            {pwError && (
              <p role="alert" className="text-[13px] text-adm-red">
                {pwError}
              </p>
            )}
            <button type="submit" className="adm-btn" disabled={!pw.currentPassword || pw.newPassword.length < 10}>
              {S.password.submit}
            </button>
          </div>
        </Row>
      </form>
    </div>
  );
}
