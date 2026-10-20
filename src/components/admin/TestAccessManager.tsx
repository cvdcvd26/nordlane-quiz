"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { useAdminI18n } from "./i18n";
import { toast } from "./toast";
import { ErrorState } from "./ui";

type TestAccount = { id: string; email: string; createdAt: string };
type AccessList = { canManage: boolean; accounts: TestAccount[] };
type NewAccess = { account: TestAccount; password: string };

/** Passwords exist only in this mounted component, until the owner dismisses the card. */
export default function TestAccessManager() {
  const { t, err: tErr } = useAdminI18n();
  const S = t.ui.settings.testAccess;
  const [data, setData] = useState<AccessList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<NewAccess | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const errorMessage = useCallback((error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === "test_access_forbidden") return S.forbidden;
      if (error.code === "test_access_limit") return S.limit;
      if (error.code === "test_access_not_found") return S.notFound;
    }
    return tErr(error);
  }, [S, tErr]);

  useEffect(() => {
    const controller = new AbortController();
    api<AccessList>("/api/admin/test-access", { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setLoadError(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      });
    return () => controller.abort();
  }, [errorMessage, reload]);

  const handleActionError = (error: unknown) => {
    setActionError(errorMessage(error));
    if (error instanceof ApiError && error.code === "test_access_forbidden") {
      setData({ canManage: false, accounts: [] });
      setFresh(null);
      setConfirm(null);
    }
  };

  const create = async () => {
    if (busy || fresh || !data?.canManage) return;
    setBusy("create");
    setActionError(null);
    setConfirm(null);
    try {
      const result = await api<NewAccess>("/api/admin/test-access", { method: "POST", json: {} });
      setFresh(result);
      setData((current) => current && ({ ...current, accounts: [result.account, ...current.accounts] }));
    } catch (error) {
      handleActionError(error);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (busy || !data?.canManage) return;
    setBusy(id);
    setActionError(null);
    try {
      await api<{ ok: true }>(`/api/admin/test-access/${encodeURIComponent(id)}`, { method: "DELETE" });
      setData((current) => current && ({ ...current, accounts: current.accounts.filter((account) => account.id !== id) }));
      setFresh((current) => current?.account.id === id ? null : current);
      setConfirm(null);
      toast({ kind: "success", title: S.deleted });
    } catch (error) {
      handleActionError(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="adm-panel mt-4" aria-labelledby="test-access-title" aria-busy={busy !== null}>
      <div className="grid gap-x-8 gap-y-3 px-4 py-5 md:grid-cols-[240px_1fr]">
        <div>
          <h2 id="test-access-title" className="adm-section-title flex items-center gap-2">
            <KeyRound aria-hidden className="size-4 text-adm-ink-3" />
            {S.title}
          </h2>
          <p className="adm-help mt-1">{S.intro}</p>
        </div>
        <div className="min-w-0 max-w-xl space-y-4">
          {loadError && <ErrorState text={loadError} onRetry={() => setReload((value) => value + 1)} />}
          {!data && !loadError && <div className="adm-skeleton h-20" aria-label={t.ui.common.loading} aria-busy />}
          {data && !data.canManage && <p className="adm-help">{S.unavailable}</p>}
          {data?.canManage && (
            <>
              {fresh && (
                <div className="rounded-lg border border-adm-line-strong bg-adm-subtle p-4" aria-labelledby="test-access-ready" role="region">
                  <h3 id="test-access-ready" className="text-[13.5px] font-semibold">{S.credentialsTitle}</h3>
                  <p className="adm-help mt-1" id="test-access-once">{S.credentialsHint}</p>
                  <div className="mt-3 grid gap-3">
                    <label className="adm-label" htmlFor="test-access-login">
                      {S.login}
                      <input id="test-access-login" className="adm-input mt-1.5" type="text" autoComplete="off" readOnly value={fresh.account.email} onFocus={(event) => event.currentTarget.select()} />
                    </label>
                    <label className="adm-label" htmlFor="test-access-password">
                      {S.password}
                      <input id="test-access-password" className="adm-input mt-1.5 font-mono" type="text" autoComplete="off" spellCheck={false} aria-describedby="test-access-once" readOnly value={fresh.password} onFocus={(event) => event.currentTarget.select()} />
                    </label>
                  </div>
                  <button type="button" className="adm-btn mt-3" disabled={busy !== null} onClick={() => setFresh(null)}>{S.dismiss}</button>
                </div>
              )}
              {data.accounts.length === 0 ? <p className="adm-help">{S.empty}</p> : (
                <ul className="divide-y divide-adm-line rounded-lg border border-adm-line">
                  {data.accounts.map((account) => (
                    <li key={account.id} className="px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-all text-[13.5px] font-medium">{account.email}</p>
                          <p className="adm-help mt-0.5">{S.createdAt}: <time dateTime={account.createdAt}>{new Date(account.createdAt).toLocaleString(t.locale, { timeZone: "Europe/Warsaw", dateStyle: "medium", timeStyle: "short" })}</time></p>
                        </div>
                        <button type="button" className="adm-btn adm-btn-danger adm-btn-sm" disabled={busy !== null} aria-label={`${S.delete}: ${account.email}`} onClick={() => { setConfirm(account.id); setActionError(null); }}>
                          <Trash2 aria-hidden className="size-3.5" />
                          {S.delete}
                        </button>
                      </div>
                      {confirm === account.id && (
                        <div className="mt-3 rounded-lg border border-[#efc2bd] bg-adm-red-bg p-3">
                          <p className="text-[13px] text-adm-red">{S.confirmDelete(account.email)}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button type="button" className="adm-btn adm-btn-sm" disabled={busy !== null} onClick={() => setConfirm(null)}>{t.ui.list.cancel}</button>
                            <button type="button" className="adm-btn adm-btn-danger-solid adm-btn-sm" disabled={busy !== null} onClick={() => void remove(account.id)}>{busy === account.id ? S.deleting : t.ui.list.confirmYes}</button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="adm-btn adm-btn-primary" disabled={busy !== null || fresh !== null} onClick={() => void create()}>{busy === "create" ? S.creating : S.create}</button>
            </>
          )}
          {actionError && <p role="alert" className="text-[13px] text-adm-red">{actionError}</p>}
        </div>
      </div>
    </section>
  );
}
