"use client";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { content } from "@/config/content";

export function ImagePreview({ image, onClose }: { image: { name: string; preview: string } | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (!image) {
      if (node.open) node.close();
      return;
    }
    if (!node.open) node.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [image]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="m-auto max-h-[90dvh] w-[92vw] max-w-4xl overflow-auto rounded-2xl border border-line-strong bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 id={title} className="min-w-0 flex-1 truncate text-sm font-semibold">{image?.name}</h2>
        <button type="button" onClick={onClose} aria-label={content.task.upload.closePreview} className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-strong text-ink-soft hover:bg-white/5 hover:text-ink">
          <X aria-hidden size={18} />
        </button>
      </div>
      {image && (
        <div className="bg-paper p-3 sm:p-5">
          {/* eslint-disable-next-line @next/next/no-img-element -- private uploaded image / local preview */}
          <img src={image.preview} alt={image.name} className="mx-auto max-h-[70dvh] max-w-full object-contain" />
        </div>
      )}
    </dialog>
  );
}
