"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ClipboardPaste, Download, FileText, LoaderCircle, ShieldCheck } from "lucide-react";
import { documentAdminContent } from "@/config/document-admin";
import { parseDocumentInput, type DocumentInputError } from "@/lib/document-input";
import { CONTRACT_LIMITS, contractDataSchema, type ContractData } from "@/lib/documents";
import { useAdminI18n } from "./i18n";
import { PageHeader } from "./ui";

type GenerationError = keyof (typeof documentAdminContent)["en"]["errors"];
type DownloadFile = { url: string; filename: string };
const emptyDetails: ContractData = { date: "", fullName: "", address: "" };

function startDownload(file: DownloadFile) {
  const anchor = document.createElement("a");
  anchor.href = file.url;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Mounted only after the server has verified the main administrator. No form data is persisted. */
export default function DocumentGenerator() {
  const { lang } = useAdminI18n();
  const T = documentAdminContent[lang];
  const router = useRouter();
  const [source, setSource] = useState("");
  const [details, setDetails] = useState<ContractData>(emptyDetails);
  const [parseError, setParseError] = useState<DocumentInputError | null>(null);
  const [parsed, setParsed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<GenerationError | null>(null);
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState<DownloadFile | null>(null);
  const downloadUrl = useRef<string | null>(null);
  const generation = useRef<AbortController | null>(null);

  useEffect(() => () => {
    generation.current?.abort();
    generation.current = null;
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = null;
    setDownload(null);
    setBusy(false);
    setSource("");
    setDetails(emptyDetails);
    setError(null);
    setParseError(null);
    setParsed(false);
    setAttempted(false);
  }, []);

  const forgetDownload = () => {
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = null;
    setDownload(null);
    setError(null);
  };

  const update = (field: keyof ContractData, value: string) => {
    forgetDownload();
    setParsed(false);
    setDetails(previous => ({ ...previous, [field]: value }));
  };

  const parse = () => {
    const result = parseDocumentInput(source);
    setParsed(false);
    if (!result.ok) {
      setParseError(result.reason);
      return;
    }
    forgetDownload();
    setDetails(result.data);
    setParseError(null);
    setAttempted(false);
    setParsed(true);
  };

  const validation = contractDataSchema.safeParse(details);
  const invalidFields = new Set(validation.success ? [] : validation.error.issues.map(issue => issue.path[0]));

  const generate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (generation.current) return;
    setAttempted(true);
    forgetDownload();
    const validated = contractDataSchema.safeParse(details);
    if (!validated.success) {
      const firstField = validated.error.issues[0]?.path[0];
      if (typeof firstField === "string") document.getElementById(`document-${firstField}`)?.focus();
      return;
    }

    const controller = new AbortController();
    generation.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/pdf" },
        body: JSON.stringify(validated.data),
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) {
        const body: { code?: string } = await response.json().catch(() => ({}));
        if (response.status === 401) {
          setError("expired");
          router.replace("/admin/login");
        } else if (response.status === 403 || response.status === 404) {
          setError("forbidden");
          router.replace("/admin");
        } else if (body.code === "document_layout") {
          setError("layout");
        } else if (body.code === "document_characters") {
          setError("characters");
        } else if (body.code === "contract_invalid" || response.status === 413) {
          setError("invalid");
        } else {
          setError(response.status === 429 ? "limited" : "unavailable");
        }
        return;
      }
      if (!response.headers.get("Content-Type")?.toLowerCase().includes("application/pdf")) {
        setError("unavailable");
        return;
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (!blob.size) {
        setError("unavailable");
        return;
      }
      const file = { url: URL.createObjectURL(blob), filename: `Umowa_${validated.data.date}.pdf` };
      downloadUrl.current = file.url;
      setDownload(file);
      startDownload(file);
    } catch {
      if (!controller.signal.aborted) setError("network");
    } finally {
      if (generation.current === controller) {
        generation.current = null;
        setBusy(false);
      }
    }
  };

  const clear = () => {
    forgetDownload();
    setSource("");
    setDetails(emptyDetails);
    setParseError(null);
    setParsed(false);
    setAttempted(false);
  };

  return (
    <div>
      <PageHeader title={T.title} description={T.description} />
      <div className="grid items-start gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="adm-panel min-w-0" aria-labelledby="document-paste-title">
          <div className="border-b border-adm-line px-4 py-4">
            <h2 id="document-paste-title" className="adm-section-title flex items-center gap-2">
              <span aria-hidden="true" className="grid size-6 place-items-center rounded-md bg-adm-subtle text-[12px] text-adm-ink-2">1</span>
              {T.pasteTitle}
            </h2>
            <p className="adm-help mt-2 leading-relaxed">{T.pasteHint}</p>
          </div>
          <div className="px-4 py-4">
            <label htmlFor="document-source" className="adm-label">{T.pasteLabel}</label>
            <textarea
              id="document-source"
              className="adm-input mt-2 min-h-44 resize-y font-mono text-base! sm:text-[13px]!"
              value={source}
              onChange={event => { setSource(event.target.value); setParseError(null); setParsed(false); }}
              placeholder={T.placeholder}
              maxLength={1600}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              aria-invalid={!!parseError || undefined}
              aria-describedby={parseError ? "document-parse-error" : undefined}
            />
            {parseError && <p id="document-parse-error" role="alert" className="mt-2 text-[12.5px] text-adm-red">{T.parseErrors[parseError]}</p>}
            <button type="button" onClick={parse} disabled={busy || !source.trim()} className="adm-btn mt-3">
              <ClipboardPaste aria-hidden="true" className="size-4" />
              {T.parse}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </button>
            {parsed && <p role="status" className="mt-3 flex items-start gap-1.5 text-[12.5px] text-adm-green"><Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{T.parsed}</p>}
          </div>
        </section>

        <section className="adm-panel min-w-0" aria-labelledby="document-review-title" aria-busy={busy}>
          <form onSubmit={generate} noValidate autoComplete="off">
            <div className="border-b border-adm-line px-4 py-4">
              <h2 id="document-review-title" className="adm-section-title flex items-center gap-2">
                <span aria-hidden="true" className="grid size-6 place-items-center rounded-md bg-adm-subtle text-[12px] text-adm-ink-2">2</span>
                {T.reviewTitle}
              </h2>
              <p className="adm-help mt-2 leading-relaxed">{T.reviewHint}</p>
            </div>
            <div className="space-y-4 px-4 py-4">
              {([
                { key: "date", label: T.date, hint: T.dateHint, message: T.invalidDate },
                { key: "fullName", label: T.fullName, hint: T.nameHint, message: T.invalidName },
                { key: "address", label: T.address, hint: T.addressHint, message: T.invalidAddress },
              ] as const).map(field => {
                const invalid = attempted && invalidFields.has(field.key);
                return (
                  <div key={field.key}>
                    <label htmlFor={`document-${field.key}`} className="adm-label">{field.label}</label>
                    <input
                      id={`document-${field.key}`}
                      name={field.key}
                      type={field.key === "date" ? "date" : "text"}
                      className={`adm-input mt-1.5 text-base! sm:text-[13.5px]! ${field.key === "date" ? "max-w-56" : ""}`}
                      value={details[field.key]}
                      onChange={event => update(field.key, event.target.value)}
                      min={field.key === "date" ? "1900-01-01" : undefined}
                      max={field.key === "date" ? "2100-12-31" : undefined}
                      maxLength={field.key === "date" ? undefined : CONTRACT_LIMITS[field.key].max}
                      disabled={busy}
                      autoComplete="off"
                      required
                      aria-invalid={invalid || undefined}
                      aria-describedby={`document-${field.key}-hint${invalid ? ` document-${field.key}-error` : ""}`}
                    />
                    <p id={`document-${field.key}-hint`} className="adm-help mt-1.5 leading-relaxed">{field.hint}</p>
                    {invalid && <p id={`document-${field.key}-error`} className="mt-1 text-[12.5px] text-adm-red">{field.message}</p>}
                  </div>
                );
              })}
              <div className="flex items-start gap-2 rounded-md bg-adm-subtle px-3 py-3">
                <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-adm-ink-3" />
                <div><p className="text-[12.5px] font-semibold">{T.output}</p><p className="adm-help mt-0.5 leading-relaxed">{T.outputHint}</p></div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-adm-line bg-adm-subtle/60 px-4 py-3">
              <button type="button" onClick={clear} className="adm-btn adm-btn-quiet" disabled={busy || (!source && !details.date && !details.fullName && !details.address)}>{T.clear}</button>
              <button type="submit" className="adm-btn adm-btn-primary ml-auto" disabled={busy}>
                {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <Download aria-hidden="true" className="size-4" />}
                {busy ? T.generating : T.generate}
              </button>
            </div>
          </form>
        </section>
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg border border-[#efc2bd] bg-adm-red-bg px-4 py-3 text-[13px] text-adm-red">{T.errors[error]}</p>}
      {download && (
        <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[#a8d7bc] bg-adm-green-bg px-4 py-3 text-[13px] text-adm-green">
          <Check aria-hidden="true" className="size-4" /><p className="flex-1">{T.success}</p>
          <a href={download.url} download={download.filename} className="adm-btn">{T.downloadAgain}</a>
        </div>
      )}
      <p className="adm-help mt-4 flex items-start gap-2 leading-relaxed"><ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{T.privacy}</p>
    </div>
  );
}
