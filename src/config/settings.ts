function positiveInteger(name: string, value: string | undefined, fallback: number, maximum: number) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  return n;
}

/**
 * Behaviour settings. Values below are defaults; the editable ones are changed
 * by the administrator in /admin/settings (stored in the database).
 */
export const uploadConfig = {
  /** Allowed screenshot types (checked against both the declared type and the file bytes). */
  screenshotTypes: ["image/png", "image/jpeg", "image/webp"],
  /** Both chat participants may send images and PDF documents. Task uploads remain screenshots only. */
  chatAttachmentTypes: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
  /** Types the administrator may attach to messages. */
  adminAttachmentTypes: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
  /** At most 4 MB: a Vercel serverless function accepts request bodies up to 4.5 MB. */
  maxFileSizeBytes: positiveInteger("NEXT_PUBLIC_MAX_FILE_MB", process.env.NEXT_PUBLIC_MAX_FILE_MB, 4, 4) * 1024 * 1024,
  maxFilesPerSubmission: positiveInteger("NEXT_PUBLIC_MAX_FILES", process.env.NEXT_PUBLIC_MAX_FILES, 6, 20),
  maxFilesPerMessage: 3,
  maxPendingChatFiles: 12,
} as const;

/** Public reviews (testimonials) shown on the first screen after moderation. */
export const testimonialConfig = {
  minLength: 10,
  maxLength: 600,
  maxNameLength: 40,
  /** How many published reviews the first screen loads. */
  publicLimit: 24,
} as const;

/** Review written on the task step. */
export const reviewConfig = { minLength: 10, maxLength: 3000 } as const;

export const chatConfig = {
  pageSize: 100,
  pollIntervalMs: 4000,
  maxMessageLength: 4000,
} as const;

export type EditableSettings = {
  autoMessageEnabled: boolean;
  autoMessageText: string;
  autoMessageMinDelaySeconds: number;
  autoMessageMaxDelaySeconds: number;
  chatAttachmentsEnabled: boolean;
};

export const defaultSettings: EditableSettings = {
  autoMessageEnabled: true,
  autoMessageText:
    "Dziękujemy za przesłanie zadania. Otrzymaliśmy Twoją odpowiedź i załączniki. Jeśli chcesz coś dodać lub masz pytanie, napisz tutaj.",
  autoMessageMinDelaySeconds: 0,
  autoMessageMaxDelaySeconds: 0,
  chatAttachmentsEnabled: true,
};

export const typeLabel = (mime: string) =>
  ({ "image/png": "PNG", "image/jpeg": "JPG", "image/webp": "WEBP", "application/pdf": "PDF" })[mime] ?? mime;
