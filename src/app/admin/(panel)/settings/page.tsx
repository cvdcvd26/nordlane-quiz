"use client";
import { useEffect, useState } from "react";
import type { EditableSettings } from "@/config/settings";
import { api } from "@/lib/api";
import { content } from "@/config/content";

export default function SettingsPage() {
  const [s, setS] = useState<EditableSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", repeat: "" });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<{ settings: EditableSettings }>("/api/admin/settings")
      .then((r) => setS(r.settings))
      .catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ settings: EditableSettings }>("/api/admin/settings", { method: "PUT", json: s });
      setS(r.settings);
      setMsg({ ok: true, text: content.admin.settings.saved });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.newPassword !== pw.repeat) return setPwMsg({ ok: false, text: content.admin.settings.password.mismatch });
    try {
      await api("/api/admin/password", { method: "POST", json: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      setPw({ currentPassword: "", newPassword: "", repeat: "" });
      setPwMsg({ ok: true, text: content.admin.settings.password.changed });
    } catch (err) {
      setPwMsg({ ok: false, text: (err as Error).message });
    }
  };

  if (!s) return msg ? <p className="text-danger">{msg.text}</p> : <div className="skeleton h-64 rounded-(--radius-tile)" aria-busy />;

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_20rem]">
      <form onSubmit={save} className="max-w-2xl">
        <h1 className="text-2xl font-semibold">{content.admin.settings.title}</h1>
        <p className="mt-2 text-sm text-slate">
          {content.admin.settings.intro}
        </p>

        <label className="mt-6 flex items-center gap-3">
          <input type="checkbox" className="size-5 accent-ink" checked={s.autoMessageEnabled} onChange={(e) => setS({ ...s, autoMessageEnabled: e.target.checked })} />
          <span className="font-medium">{content.admin.settings.enabled}</span>
        </label>

        <label className="mt-6 block text-sm font-medium" htmlFor="text">
          {content.admin.settings.text}
        </label>
        <textarea id="text" className="field mt-1.5 min-h-36" value={s.autoMessageText} onChange={(e) => setS({ ...s, autoMessageText: e.target.value })} maxLength={4000} />

        <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-sm">
          <label className="text-sm font-medium">
            {content.admin.settings.delayFrom}
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
            {content.admin.settings.delayTo}
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
        <p className="mt-2 text-xs text-slate">{content.admin.settings.delayHint}</p>

        <h2 className="mt-10 text-lg font-semibold">{content.admin.settings.chat}</h2>
        <label className="mt-3 flex items-center gap-3">
          <input type="checkbox" className="size-5 accent-ink" checked={s.chatAttachmentsEnabled} onChange={(e) => setS({ ...s, chatAttachmentsEnabled: e.target.checked })} />
          <span>{content.admin.settings.attachments}</span>
        </label>

        <div className="mt-8 flex items-center gap-4">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? content.admin.settings.saving : content.admin.settings.save}
          </button>
          {msg && (
            <span role="status" className={`text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </form>

      <form onSubmit={changePw} className="self-start rounded-(--radius-tile) border-2 border-line bg-surface p-5">
        <h2 className="font-semibold">{content.admin.settings.password.title}</h2>
        {(
          [
            ["currentPassword", content.admin.settings.password.current, "current-password"],
            ["newPassword", content.admin.settings.password.next, "new-password"],
            ["repeat", content.admin.settings.password.repeat, "new-password"],
          ] as const
        ).map(([key, label, ac]) => (
          <label key={key} className="mt-4 block text-sm font-medium">
            {label}
            <input type="password" autoComplete={ac} className="field mt-1.5" value={pw[key]} onChange={(e) => setPw({ ...pw, [key]: e.target.value })} />
          </label>
        ))}
        <button type="submit" className="btn btn-primary mt-5 w-full" disabled={!pw.currentPassword || pw.newPassword.length < 10}>
          {content.admin.settings.password.submit}
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
