"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Maximize2, RotateCcw, Trash2, Upload } from "lucide-react";
import { content } from "@/config/content";
import { typeLabel } from "@/config/settings";
import { api, formatBytes, newId, uploadWithProgress, type PublicFile } from "@/lib/api";
import { ImagePreview } from "./ImagePreview";

export type UploadItem = {
  key: string;
  name: string;
  size: number;
  mime: string;
  preview: string;
  status: "uploading" | "done" | "error";
  progress: number;
  error?: string;
  file?: File; // kept for retry
  serverId?: string;
  abort?: () => void;
};

type Props = {
  items: UploadItem[];
  setItems: (fn: (prev: UploadItem[]) => UploadItem[]) => void;
  limits: { maxFiles: number; maxFileSizeBytes: number; types: string[] };
  disabled?: boolean;
};

export const fromServer = (f: PublicFile): UploadItem => ({
  key: f.id,
  name: f.name,
  size: f.size,
  mime: f.mime,
  preview: f.url,
  status: "done",
  progress: 1,
  serverId: f.id,
});

export function Uploader({ items, setItems, limits, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const selectedImage = items.find((item) => item.key === previewKey && item.status === "done") ?? null;
  const t = content.task.upload;
  const maxMb = Math.round(limits.maxFileSizeBytes / 1024 / 1024);

  // Release preview object URLs.
  const urls = useRef(new Set<string>());
  const removed = useRef(new Set<string>());
  useEffect(() => {
    const set = urls.current;
    return () => set.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const start = (item: UploadItem, file: File) => {
    const form = new FormData();
    form.set("file", file);
    form.set("purpose", "submission");
    const { promise, abort } = uploadWithProgress<{ file: PublicFile }>("/api/uploads", form, (p) =>
      setItems((prev) => prev.map((x) => (x.key === item.key ? { ...x, progress: p } : x))),
    );
    setItems((prev) => prev.map((x) => (x.key === item.key ? { ...x, abort, status: "uploading", progress: 0, error: undefined } : x)));
    promise
      .then(async ({ file: saved }) => {
        URL.revokeObjectURL(item.preview);
        urls.current.delete(item.preview);
        if (removed.current.has(item.key)) {
          await api(`/api/uploads/${saved.id}`, { method: "DELETE" });
          return;
        }
        setItems((prev) => prev.map((x) => x.key === item.key
          ? { ...x, status: "done", progress: 1, serverId: saved.id, preview: saved.url, abort: undefined } : x));
      })
      .catch((err) => {
        if (err.code === "aborted") return;
        setItems((prev) => prev.map((x) => (x.key === item.key ? { ...x, status: "error", error: err.message, abort: undefined } : x)));
      });
  };

  const addFiles = (list: FileList | File[]) => {
    setNotice(null);
    const files = Array.from(list);
    const room = limits.maxFiles - items.length;
    if (files.length > room) setNotice(content.errors.fileCount(limits.maxFiles));
    const accepted: { item: UploadItem; file: File }[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      if (!limits.types.includes(file.type)) {
        setNotice(`${file.name}: ${content.errors.fileType}`);
        continue;
      }
      if (file.size > limits.maxFileSizeBytes) {
        setNotice(`${file.name}: ${content.errors.fileSize(maxMb)}`);
        continue;
      }
      const preview = URL.createObjectURL(file);
      urls.current.add(preview);
      accepted.push({ item: { key: newId(), name: file.name, size: file.size, mime: file.type, preview, status: "uploading", progress: 0, file }, file });
    }
    if (!accepted.length) return;
    setItems((prev) => [...prev, ...accepted.map((a) => a.item)]);
    accepted.forEach((a) => start(a.item, a.file));
  };

  const remove = async (item: UploadItem) => {
    removed.current.add(item.key);
    if (previewKey === item.key) setPreviewKey(null);
    setItems((prev) => prev.filter((x) => x.key !== item.key));
    if (!item.serverId && item.status !== "uploading") {
      URL.revokeObjectURL(item.preview);
      urls.current.delete(item.preview);
    }
    if (item.serverId) {
      try {
        await api(`/api/uploads/${item.serverId}`, { method: "DELETE" });
      } catch (err) {
        removed.current.delete(item.key);
        setItems((prev) => [...prev, item]); // put it back if deletion failed
        setNotice((err as Error).message);
      }
    }
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!disabled && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={[
          "relative rounded-(--radius-tile) border-2 border-dashed px-5 py-10 text-center transition-all duration-300 sm:py-12",
          drag ? "scale-[1.01] border-paint bg-paint-soft" : "border-line-strong bg-white/[0.02] hover:border-paint/50",
          disabled ? "opacity-60" : "",
        ].join(" ")}
      >
        <Upload aria-hidden size={23} strokeWidth={1.6} className="mx-auto mb-3 text-paint/80" />
        <p className="font-medium">{t.hint}</p>
        <p className="mt-1 text-sm text-slate">{t.limits(limits.maxFiles, maxMb, limits.types.map(typeLabel).join(", "))}</p>
        <button
          type="button"
          className="btn btn-ghost mt-5"
          onClick={() => input.current?.click()}
          disabled={disabled}
        >
          {t.button}
        </button>
        <input
          ref={input}
          type="file"
          accept={limits.types.join(",")}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <p className="mt-3 min-h-5 text-sm text-danger" role="alert">
        {notice}
      </p>

      {items.length > 0 && (
        <>
        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
          <p className="font-semibold">{t.selected}</p>
          <p className="tabular-nums text-ink-soft">{items.length} / {limits.maxFiles}</p>
        </div>
        <ul className="space-y-2.5" aria-label={t.title}>
          {items.map((item) => (
            <li
              key={item.key}
              className={`pop grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 rounded-(--radius-field) border bg-surface p-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:p-3.5 ${
                item.status === "error" ? "border-danger/40" : "border-line-strong"
              }`}
            >
              <button
                type="button"
                disabled={item.status !== "done"}
                onClick={() => setPreviewKey(item.key)}
                aria-label={t.previewName(item.name)}
                className={`grid size-14 place-items-center overflow-hidden rounded-lg border bg-paper sm:size-18 ${item.status === "error" ? "border-danger/25 bg-danger-soft text-danger" : "border-line-strong enabled:cursor-zoom-in enabled:hover:border-paint/60"}`}
              >
                {item.status === "error" ? (
                  <AlertTriangle aria-hidden size={22} strokeWidth={1.6} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- private file / object URL preview
                  <img src={item.preview} alt="" className="size-full object-cover" />
                )}
              </button>
              <div className="min-w-0 text-xs">
                <p className="truncate text-[13px] font-semibold" title={item.name}>
                  {item.name}
                </p>
                <p className="mt-1 text-[11px] text-ink-soft">{typeLabel(item.mime)} · {formatBytes(item.size)}</p>
                <p className={`mt-2 flex items-center gap-1.5 text-[11px] font-medium ${item.status === "error" ? "text-danger" : "text-sky"}`} role="status">
                  {item.status === "done" && <Check aria-hidden size={12} />}
                  {item.status === "done" ? t.uploaded : item.status === "error" ? t.failed : item.progress >= 1 ? t.processing : `${t.uploading} ${Math.round(item.progress * 100)}%`}
                </p>
                {item.status === "uploading" && (
                  <div role="progressbar" aria-label={t.uploadName(item.name)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)} className="mt-2 h-1 overflow-hidden rounded-full bg-line-strong">
                    <div className="h-full rounded-full bg-paint transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                  </div>
                )}
                {item.error && <p className="mt-1 break-words text-[11px] text-danger">{item.error}</p>}
              </div>
                <div className="col-span-2 flex items-center justify-end gap-3 sm:col-span-1">
                  {item.status === "done" && (
                    <button type="button" onClick={() => setPreviewKey(item.key)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-[11px] font-medium hover:border-paint/50 hover:text-sky" aria-label={t.previewName(item.name)}>
                      <Maximize2 aria-hidden size={12} /> {t.preview}
                    </button>
                  )}
                  {item.status === "error" && item.file && (
                    <button type="button" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-[11px] font-medium hover:border-paint/50" disabled={disabled} onClick={() => start(item, item.file!)}>
                      <RotateCcw aria-hidden size={12} /> {t.retry}
                    </button>
                  )}
                  {!disabled && (
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center gap-1.5 text-[11px] text-ink-soft hover:text-danger"
                      onClick={() => remove(item)}
                      aria-label={`${t.remove}: ${item.name}`}
                    >
                      <Trash2 aria-hidden size={12} /> {t.remove}
                    </button>
                  )}
                </div>
            </li>
          ))}
        </ul>
        </>
      )}
      <ImagePreview image={selectedImage} onClose={() => setPreviewKey(null)} />
    </div>
  );
}
