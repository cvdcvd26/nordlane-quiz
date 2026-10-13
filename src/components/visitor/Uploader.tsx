"use client";
import { useEffect, useRef, useState } from "react";
import { content } from "@/config/content";
import { typeLabel } from "@/config/settings";
import { api, formatBytes, newId, uploadWithProgress, type PublicFile } from "@/lib/api";

export type UploadItem = {
  key: string;
  name: string;
  size: number;
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
  preview: f.url,
  status: "done",
  progress: 1,
  serverId: f.id,
});

export function Uploader({ items, setItems, limits, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const t = content.task.upload;
  const maxMb = Math.round(limits.maxFileSizeBytes / 1024 / 1024);

  // Release preview object URLs.
  const urls = useRef(new Set<string>());
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
    setItems((prev) => prev.map((x) => (x.key === item.key ? { ...x, abort, status: "uploading", error: undefined } : x)));
    promise
      .then(({ file: saved }) =>
        setItems((prev) =>
          prev.map((x) => (x.key === item.key ? { ...x, status: "done", progress: 1, serverId: saved.id, abort: undefined } : x)),
        ),
      )
      .catch((err) => {
        if (err.code === "aborted") return;
        setItems((prev) => prev.map((x) => (x.key === item.key ? { ...x, status: "error", error: err.message, abort: undefined } : x)));
      });
  };

  const addFiles = (list: FileList | File[]) => {
    setNotice(null);
    const files = Array.from(list);
    const room = limits.maxFiles - items.filter((i) => i.status !== "error").length;
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
      accepted.push({ item: { key: newId(), name: file.name, size: file.size, preview, status: "uploading", progress: 0, file }, file });
    }
    if (!accepted.length) return;
    setItems((prev) => [...prev, ...accepted.map((a) => a.item)]);
    accepted.forEach((a) => start(a.item, a.file));
  };

  const remove = async (item: UploadItem) => {
    item.abort?.();
    setItems((prev) => prev.filter((x) => x.key !== item.key));
    if (item.serverId) {
      try {
        await api(`/api/uploads/${item.serverId}`, { method: "DELETE" });
      } catch (err) {
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
          drag ? "scale-[1.01] border-paint bg-paint-soft shadow-[0_0_40px_-10px_#3ee8b0]" : "border-line-strong bg-white/[0.02] hover:border-paint/50",
          disabled ? "opacity-60" : "",
        ].join(" ")}
      >
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
        <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={t.title}>
          {items.map((item) => (
            <li
              key={item.key}
              className={`pop overflow-hidden rounded-(--radius-field) border bg-surface ${
                item.status === "error" ? "border-danger" : "border-line"
              }`}
            >
              <div className="relative aspect-[4/3] bg-paper">
                {/* eslint-disable-next-line @next/next/no-img-element -- private file / object URL preview */}
                <img src={item.preview} alt="" className="size-full object-cover" />
                {item.status === "uploading" && (
                  <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/10">
                    <div className="h-full bg-paint shadow-[0_0_10px_#3ee8b0] transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                  </div>
                )}
                {item.status === "done" && (
                  <span className="pop absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-paint text-xs font-bold text-on-paint">
                    ✓
                  </span>
                )}
              </div>
              <div className="space-y-1 p-2.5 text-xs">
                <p className="truncate font-medium" title={item.name}>
                  {item.name}
                </p>
                <p className="text-slate">
                  {item.status === "uploading" ? `${t.uploading} ${Math.round(item.progress * 100)}%` : formatBytes(item.size)}
                </p>
                {item.error && <p className="text-danger">{item.error}</p>}
                <div className="flex gap-3 pt-0.5">
                  {item.status === "error" && item.file && (
                    <button type="button" className="font-semibold underline" onClick={() => start(item, item.file!)}>
                      {t.retry}
                    </button>
                  )}
                  {!disabled && (
                    <button
                      type="button"
                      className="text-slate underline hover:text-danger"
                      onClick={() => remove(item)}
                      aria-label={`${t.remove}: ${item.name}`}
                    >
                      {t.remove}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
