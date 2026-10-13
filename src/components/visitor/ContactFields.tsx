"use client";
import { content } from "@/config/content";
import { maskPhoneInput, nationalDigits, formatPhone, isValidPhone, normalizeTelegram } from "@/lib/contact";

export type ContactDraft = { name: string; phone: string; telegram: string };
export type ContactErrors = Partial<Record<keyof ContactDraft, string>>;

const e = content.errors;

/** Client-side validation; the server validates the same rules again. */
export function validateContact(c: ContactDraft): ContactErrors {
  const errors: ContactErrors = {};
  if (!c.name.trim()) errors.name = e.nameRequired;
  const digits = nationalDigits(c.phone);
  if (!digits) errors.phone = e.phoneRequired;
  else if (!isValidPhone(digits)) errors.phone = e.phoneInvalid;
  if (normalizeTelegram(c.telegram) === false) errors.telegram = e.telegramInvalid;
  return errors;
}

/** Turns a stored E.164 number back into the masked display value. */
export const displayPhone = (stored: string) => formatPhone(nationalDigits(stored));

type Props = {
  value: ContactDraft;
  errors: ContactErrors;
  onChange: (next: ContactDraft, field: keyof ContactDraft) => void;
};

export function ContactFields({ value, errors, onChange }: Props) {
  const t = content.quiz.contact;

  const onPhoneInput = (el: HTMLInputElement) => {
    const { value: masked, caret } = maskPhoneInput(el.value, el.selectionStart ?? el.value.length);
    onChange({ ...value, phone: masked }, "phone");
    // Restore the caret after React re-renders the controlled value.
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(caret, caret);
      } catch {}
    });
  };

  const field = (id: keyof ContactDraft, label: string, required: boolean, input: React.ReactNode) => (
    <div>
      <label htmlFor={`contact-${id}`} className="block text-sm font-medium">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {" "}*
          </span>
        )}
        {required && <span className="sr-only"> ({t.required})</span>}
      </label>
      <div className="mt-1.5">{input}</div>
      <p id={`contact-${id}-err`} className="mt-1.5 min-h-5 text-sm text-danger" role="alert">
        {errors[id]}
      </p>
    </div>
  );

  const cls = (id: keyof ContactDraft) => `field ${errors[id] ? "border-danger" : ""}`;
  const aria = (id: keyof ContactDraft) => ({
    "aria-invalid": Boolean(errors[id]),
    "aria-describedby": `contact-${id}-err`,
  });

  return (
    <fieldset className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
      <legend className="mb-4 text-lg font-semibold">{t.title}</legend>
      {field(
        "name",
        t.name.label,
        true,
        <input
          id="contact-name"
          className={cls("name")}
          autoComplete="given-name"
          maxLength={100}
          placeholder={t.name.placeholder}
          value={value.name}
          onChange={(ev) => onChange({ ...value, name: ev.target.value }, "name")}
          {...aria("name")}
        />,
      )}
      {field(
        "phone",
        t.phone.label,
        true,
        <input
          id="contact-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          className={cls("phone")}
          placeholder={t.phone.placeholder}
          value={value.phone}
          onFocus={() => !value.phone && onChange({ ...value, phone: "+48 " }, "phone")}
          onBlur={() => value.phone.trim() === "+48" && onChange({ ...value, phone: "" }, "phone")}
          onChange={(ev) => onPhoneInput(ev.target)}
          onPaste={(ev) => {
            const text = ev.clipboardData.getData("text");
            if (!text) return;
            ev.preventDefault();
            onChange({ ...value, phone: formatPhone(nationalDigits(text)) }, "phone");
          }}
          {...aria("phone")}
        />,
      )}
      <div className="sm:col-span-2">
        {field(
          "telegram",
          t.telegram.label,
          false,
          <input
            id="contact-telegram"
            className={cls("telegram")}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t.telegram.placeholder}
            value={value.telegram}
            onChange={(ev) => onChange({ ...value, telegram: ev.target.value }, "telegram")}
            {...aria("telegram")}
          />,
        )}
      </div>
    </fieldset>
  );
}
