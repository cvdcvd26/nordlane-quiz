"use client";
import { useEffect, useRef, useState } from "react";
import { uploadConfig } from "@/config/settings";
import { content } from "@/config/content";
import { api, ApiError, formatBytes, newId, uploadWithProgress, type PublicFile } from "@/lib/api";
import { fromServer, type UploadItem } from "./Uploader";

/** A separate uploader binds screenshots to the active correction request. */
export function RevisionUploader({ revisionId, initialFiles, disabled, onItems }: {
  revisionId: string; initialFiles: PublicFile[]; disabled: boolean; onItems: (items: UploadItem[]) => void;
}) {
  const [items, setItems] = useState<UploadItem[]>(() => initialFiles.map(fromServer));
  const [error, setError] = useState<string | null>(null);
  const current = useRef(items);
  const mounted = useRef(false);
  const removed = useRef(new Set<string>());
  const removedServerIds = useRef(new Set<string>());
  const observedServerIds = useRef(new Set(initialFiles.map(file => file.id)));
  const urls = useRef(new Set<string>());
  const input = useRef<HTMLInputElement>(null);
  const report = useRef(onItems);
  useEffect(() => { report.current = onItems; }, [onItems]);
  useEffect(() => { report.current(items); }, [items]);
  useEffect(() => {
    mounted.current = true;
    const previews = urls.current;
    return () => { mounted.current = false; previews.forEach(url => URL.revokeObjectURL(url)); };
  }, []);
  const update = (fn: (previous: UploadItem[]) => UploadItem[]) => {
    current.current = fn(current.current);
    if (mounted.current) setItems(current.current);
  };
  const discard = (fileId: string) => api(`/api/uploads/${fileId}`, { method: "DELETE" }).catch(() => {});

  const start = (item: UploadItem, file: File) => {
    const form = new FormData();
    form.set("file", file); form.set("revisionId", revisionId);
    update(previous => previous.map(value => value.key === item.key ? { ...value, status: "uploading", progress: 0, error: undefined } : value));
    const { promise } = uploadWithProgress<{ file: PublicFile }>("/api/task-revisions/uploads", form, progress => {
      if (mounted.current && !removed.current.has(item.key)) update(previous => previous.map(value => value.key === item.key ? { ...value, progress } : value));
    });
    // Let removed uploads finish so their returned private object can be deleted.
    promise.then(async ({ file: saved }) => {
      URL.revokeObjectURL(item.preview); urls.current.delete(item.preview);
      if (!mounted.current || removed.current.has(item.key)) { await discard(saved.id); return; }
      update(previous => previous.map(value => value.key === item.key ? { ...value, status: "done", progress: 1, serverId: saved.id, preview: saved.url } : value));
    }).catch(error => {
      if (mounted.current && !removed.current.has(item.key)) update(previous => previous.map(value => value.key === item.key ? { ...value, status: "error", error: error.message } : value));
    });
  };

  const add = (list: FileList) => {
    if (disabled) return;
    setError(null);
    const room = uploadConfig.maxFilesPerSubmission - current.current.length;
    if (list.length > room) setError(content.errors.fileCount(uploadConfig.maxFilesPerSubmission));
    const accepted: { item: UploadItem; file: File }[] = [];
    for (const file of Array.from(list).slice(0, Math.max(0, room))) {
      if (!uploadConfig.screenshotTypes.some(mime => mime === file.type)) { setError(content.errors.fileType); continue; }
      if (file.size > uploadConfig.maxFileSizeBytes) { setError(content.errors.fileSize(uploadConfig.maxFileSizeBytes / 1024 / 1024)); continue; }
      const preview = URL.createObjectURL(file); urls.current.add(preview);
      accepted.push({ file, item: { key: newId(), name: file.name, mime: file.type, size: file.size, preview, file, status: "uploading", progress: 0 } });
    }
    update(previous => [...previous, ...accepted.map(value => value.item)]);
    accepted.forEach(({ item, file }) => start(item, file));
  };
  const remove = async (item: UploadItem) => {
    if (disabled) return;
    removed.current.add(item.key);
    if (item.serverId) removedServerIds.current.add(item.serverId);
    update(previous => previous.filter(value => value.key !== item.key));
    if (!item.serverId) {
      URL.revokeObjectURL(item.preview); urls.current.delete(item.preview);
      return;
    }
    try { await api(`/api/uploads/${item.serverId}`, { method: "DELETE" }); }
    catch (error) {
      if (error instanceof ApiError && error.status === 404) return;
      if (!mounted.current) return;
      removed.current.delete(item.key); removedServerIds.current.delete(item.serverId);
      update(previous => [...previous, item]); setError((error as Error).message);
    }
  };

  useEffect(() => {
    const serverIds = new Set(initialFiles.map(file => file.id));
    const gone = new Set([...observedServerIds.current].filter(id => !serverIds.has(id)));
    observedServerIds.current = serverIds;
    // Only remove files previously seen by a server poll; retain uploads completed
    // after a poll started. This also reconciles edits from a second tab.
    const kept = current.current.filter(item => !item.serverId || !gone.has(item.serverId));
    const known = new Set(kept.flatMap(item => item.serverId ? [item.serverId] : []));
    const added = initialFiles.filter(file => !known.has(file.id) && !removedServerIds.current.has(file.id)).map(fromServer);
    current.current = [...kept, ...added];
    setItems(current.current);
  }, [initialFiles]);

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn btn-ghost" disabled={disabled || items.length >= uploadConfig.maxFilesPerSubmission} onClick={() => input.current?.click()}>Dodaj poprawione zrzuty ekranu</button>
      <span className="text-xs text-ink-soft">{items.length}/{uploadConfig.maxFilesPerSubmission} · PNG, JPG, WEBP · do {uploadConfig.maxFileSizeBytes / 1024 / 1024} MB</span>
      <input ref={input} type="file" accept={uploadConfig.screenshotTypes.join(",")} multiple hidden onChange={event => { if (event.target.files) add(event.target.files); event.target.value = ""; }} />
    </div>
    {items.length > 0 && <ul className="space-y-2" aria-label="Poprawione zrzuty ekranu">
      {items.map(item => <li key={item.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-surface p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- private screenshot/object URL */}
        <img src={item.preview} alt="" className="size-12 rounded-lg object-cover" />
        <div className="min-w-0 flex-1 text-xs">
          {item.serverId ? <a href={item.preview} target="_blank" rel="noreferrer" className="break-all underline underline-offset-2">{item.name}</a> : <p className="break-all">{item.name}</p>}
          <p className="mt-1 text-ink-soft">{formatBytes(item.size)} · {item.status === "done" ? "Dodano" : item.status === "error" ? "Błąd przesyłania" : `Przesyłanie ${Math.round(item.progress * 100)}%`}</p>
          {item.error && <p role="alert" className="mt-1 text-danger">{item.error}</p>}
        </div>
        {item.status === "error" && item.file && <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" disabled={disabled} onClick={() => start(item, item.file!)}>Ponów</button>}
        <button type="button" className="min-h-9 px-2 text-xs text-ink-soft hover:text-danger" disabled={disabled} onClick={() => void remove(item)} aria-label={`Usuń: ${item.name}`}>Usuń</button>
      </li>)}
    </ul>}
    {error && <p className="text-sm text-danger" role="alert">{error}</p>}
  </div>;
}
