/**
 * Behaviour settings. Values below are defaults; the editable ones are changed
 * by the administrator in /admin/settings (stored in the database).
 */
export const uploadConfig = {
  /** Allowed screenshot types (checked against both the declared type and the file bytes). */
  screenshotTypes: ["image/png", "image/jpeg", "image/webp"],
  /** Types the administrator may attach to messages. */
  adminAttachmentTypes: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
  /** At most 4 MB: a Vercel serverless function accepts request bodies up to 4.5 MB. */
  maxFileSizeBytes: Number(process.env.NEXT_PUBLIC_MAX_FILE_MB ?? 4) * 1024 * 1024,
  maxFilesPerSubmission: Number(process.env.NEXT_PUBLIC_MAX_FILES ?? 6),
  maxFilesPerMessage: 3,
} as const;

/** Review written on the task step. */
export const reviewConfig = { minLength: 10, maxLength: 3000 } as const;

export const chatConfig = {
  pollIntervalMs: 4000,
  maxMessageLength: 4000,
} as const;

export type EditableSettings = {
  autoMessageEnabled: boolean;
  autoMessageText: string;
  autoMessageMinDelayMinutes: number;
  autoMessageMaxDelayMinutes: number;
  chatAttachmentsEnabled: boolean;
};

export const defaultSettings: EditableSettings = {
  autoMessageEnabled: true,
  autoMessageText:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore — odpowiedz na tę wiadomość, aby kontynuować.",
  autoMessageMinDelayMinutes: 20,
  autoMessageMaxDelayMinutes: 30,
  chatAttachmentsEnabled: true,
};

export const typeLabel = (mime: string) =>
  ({ "image/png": "PNG", "image/jpeg": "JPG", "image/webp": "WEBP", "application/pdf": "PDF" })[mime] ?? mime;
