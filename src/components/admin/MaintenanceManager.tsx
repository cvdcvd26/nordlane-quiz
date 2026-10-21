"use client";

import { useEffect, useRef, useState } from "react";
import { Wrench } from "lucide-react";
import { maintenanceAdminContent } from "@/config/maintenance";
import { ApiError, api } from "@/lib/api";
import { useAdminI18n } from "./i18n";

type MaintenanceAccess =
  | { canManage: false }
  | { canManage: true; enabled: boolean; updatedAt: string | null };

/** Hidden until the API confirms the authenticated main administrator's capability. */
export default function MaintenanceManager() {
  const { lang } = useAdminI18n();
  const M = maintenanceAdminContent[lang];
  const [data, setData] = useState<MaintenanceAccess | null>(null);
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"save" | "load" | null>(null);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const saveController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<MaintenanceAccess>("/api/admin/maintenance", { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        if (result.canManage) setDraft(result.enabled);
        setError(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
          setData({ canManage: false });
        } else {
          setError("load");
        }
      });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => () => saveController.current?.abort(), []);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !data?.canManage || draft === data.enabled) return;
    const controller = new AbortController();
    saveController.current = controller;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api<MaintenanceAccess>("/api/admin/maintenance", {
        method: "PUT",
        json: { enabled: draft },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setData(result);
      if (result.canManage) {
        setDraft(result.enabled);
        setSaved(true);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        setData({ canManage: false });
      } else {
        setError("save");
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  if (!data && error === "load") {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-adm-line bg-adm-surface px-4 py-3">
        <p role="alert" className="text-[13px] text-adm-red">{M.loadError}</p>
        <button
          type="button"
          className="adm-btn ml-auto"
          onClick={() => { setError(null); setReload((value) => value + 1); }}
        >
          {M.retry}
        </button>
      </div>
    );
  }

  if (!data?.canManage) return null;

  const dirty = draft !== data.enabled;

  return (
    <section className="adm-panel mt-4" aria-labelledby="maintenance-settings-title" aria-busy={busy}>
      <form onSubmit={save}>
        <div className="grid gap-x-8 gap-y-3 px-4 py-5 md:grid-cols-[240px_1fr]">
          <div>
            <h2 id="maintenance-settings-title" className="adm-section-title flex items-center gap-2">
              <Wrench size={16} className="text-adm-ink-3" aria-hidden="true" />
              {M.title}
            </h2>
            <p className="adm-help mt-1">{M.intro}</p>
          </div>
          <div className="min-w-0 max-w-xl">
            <p className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-semibold ${data.enabled ? "bg-adm-amber-bg text-adm-amber" : "bg-adm-green-bg text-adm-green"}`}>
              <span aria-hidden="true" className={`size-1.5 rounded-full ${data.enabled ? "bg-adm-amber" : "bg-adm-green"}`} />
              {data.enabled ? M.enabled : M.disabled}
            </p>
            <label className="mt-4 flex items-start gap-2.5">
              <input
                type="checkbox"
                className="adm-check mt-0.5"
                checked={draft}
                disabled={busy}
                onChange={(event) => { setDraft(event.target.checked); setSaved(false); setError(null); }}
                aria-describedby="maintenance-settings-description"
              />
              <span className="text-[13.5px] font-medium">{M.toggle}</span>
            </label>
            <p id="maintenance-settings-description" className="adm-help mt-2">{data.enabled ? M.activeHint : M.inactiveHint}</p>
            <p className="adm-help mt-3">{M.ownerOnly}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-adm-line bg-adm-subtle/60 px-4 py-3">
          {error ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="text-[13px] text-adm-red">{error === "load" ? M.loadError : M.saveError}</p>
              {error === "load" && <button type="button" className="adm-btn" onClick={() => setReload((value) => value + 1)}>{M.retry}</button>}
            </div>
          ) : (
            <p role="status" aria-live="polite" className={`text-[12px] ${saved ? "text-adm-green" : "text-adm-ink-3"}`}>
              {saved ? M.saved : dirty ? M.unsaved : ""}
            </p>
          )}
          <button type="submit" className="adm-btn adm-btn-primary ml-auto" disabled={busy || !dirty}>
            {busy ? M.saving : M.save}
          </button>
        </div>
      </form>
    </section>
  );
}
