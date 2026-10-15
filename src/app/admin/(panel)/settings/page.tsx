"use client";
import { useEffect, useState } from "react";
import type { EditableSettings } from "@/config/settings";
import { api } from "@/lib/api";
import { useAdminI18n } from "@/components/admin/i18n";

export default function SettingsPage() {
  const { t, err: tErr } = useAdminI18n();
  const [s, setS] = useState<EditableSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", repeat: "" });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<{ settings: EditableSettings }>("/api/admin/settings")
      .then((r) => setS(r.settings))
      .catch((e) => setMsg({ ok: false, text: tErr(e) }));
  }, [tErr]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ settings: EditableSettings }>("/api/admin/settings", { method: "PUT", json: s });
      setS(r.settings);
      setMsg({ ok: true, text: t.ui.settings.saved });
    } catch (err) {
      setMsg({ ok: false, text: tErr(err) });
    } finally {
      setBusy(false);
    }
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.newPassword !== pw.repeat) return setPwMsg({ ok: false, text: t.ui.settings.password.mismatch });
    try {
      await api("/api/admin/password", { method: "POST", json: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      setPw({ currentPassword: "", newPassword: "", repeat: "" });
      setPwMsg({ ok: true, text: t.ui.settings.password.changed });
    } catch (err) {
      setPwMsg({ ok: false, text: tErr(err) });
    }
  };

  if (!s) return msg ? <p className="text-danger">{msg.text}</p> : <div className="skeleton h-64 rounded-(--radius-tile)" aria-busy />;

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_20rem]">
      <form onSubmit={save} className="max-w-2xl">
        <h1 className="text-2xl font-semibold">{t.ui.settings.title}</h1>
        <p className="mt-2 text-sm text-slate">
          {t.ui.settings.intro}
        </p>

        <label className="mt-6 flex items-center gap-3">
          <input type="checkbox" className="size-5 accent-[#168bff]" checked={s.autoMessageEnabled} onChange={(e) => setS({ ...s, autoMessageEnabled: e.target.checked })} />
          <span className="font-medium">{t.ui.settings.enabled}</span>
        </label>

        <label className="mt-6 block text-sm font-medium" htmlFor="text">
          {t.ui.settings.text}
        </label>
        <textarea id="text" className="field mt-1.5 min-h-36" value={s.autoMessageText} onChange={(e) => setS({ ...s, autoMessageText: e.target.value })} maxLength={4000} />

        <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-sm">
          <label className="text-sm font-medium">
            {t.ui.settings.delayFrom}
            <input
              type="number"
              min={0}
              max={1440}
              className="field mt-1.5"
              value={s.autoMessageMinDelayMinutes}
              onChange={(e) => setS({ ...s, autoMessageMinDelayMinutes: Number(e.target.value) })}
            />
          </label>
          <label className="text-sm font-medium">
            {t.ui.settings.delayTo}
            <input
              type="number"
              min={0}
              max={1440}
              className="field mt-1.5"
              value={s.autoMessageMaxDelayMinutes}
              onChange={(e) => setS({ ...s, autoMessageMaxDelayMinutes: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate">{t.ui.settings.delayHint}</p>

        <h2 className="mt-10 text-lg font-semibold">{t.ui.settings.chat}</h2>
        <label className="mt-3 flex items-center gap-3">
          <input type="checkbox" className="size-5 accent-[#168bff]" checked={s.chatAttachmentsEnabled} onChange={(e) => setS({ ...s, chatAttachmentsEnabled: e.target.checked })} />
          <span>{t.ui.settings.attachments}</span>
        </label>

        <div className="mt-8 flex items-center gap-4">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t.ui.settings.saving : t.ui.settings.save}
          </button>
          {msg && (
            <span role="status" className={`text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </form>

      <form onSubmit={changePw} className="self-start rounded-(--radius-tile) glass p-5">
        <h2 className="font-semibold">{t.ui.settings.password.title}</h2>
        {(
          [
            ["currentPassword", t.ui.settings.password.current, "current-password"],
            ["newPassword", t.ui.settings.password.next, "new-password"],
            ["repeat", t.ui.settings.password.repeat, "new-password"],
          ] as const
        ).map(([key, label, ac]) => (
          <label key={key} className="mt-4 block text-sm font-medium">
            {label}
            <input type="password" autoComplete={ac} className="field mt-1.5" value={pw[key]} onChange={(e) => setPw({ ...pw, [key]: e.target.value })} />
          </label>
        ))}
        <button type="submit" className="btn btn-primary mt-5 w-full" disabled={!pw.currentPassword || pw.newPassword.length < 10}>
          {t.ui.settings.password.submit}
        </button>
        {pwMsg && (
          <p role="status" className={`mt-3 text-sm ${pwMsg.ok ? "text-ok" : "text-danger"}`}>
            {pwMsg.text}
          </p>
        )}
      </form>
    </div>
  );
}
