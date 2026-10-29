export const revisionConfig = { maxInstructionsLength: 3000, maxResponseLength: 3000 } as const;

export const revisionFilePrefix = (sessionId: string) => `uploads/${sessionId}/revisions/`;
export function revisionIdForFileKey(sessionId: string, storageKey: string) {
  const prefix = revisionFilePrefix(sessionId);
  return storageKey.startsWith(prefix) ? storageKey.slice(prefix.length).split("/")[0] : null;
}

export type TaskRevision = {
  id: string;
  instructions: string;
  status: "pending" | "submitted" | "cancelled";
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
};

export const revisionErrors = {
  notSubmitted: "Najpierw prześlij zadanie.",
  pending: "To zgłoszenie ma już aktywną prośbę o poprawę.",
  inactive: "Ta prośba o poprawę nie jest już aktywna. Odśwież stronę.",
  changed: "Prośba została już zrealizowana. Odśwież historię.",
  empty: "Dodaj poprawiony tekst lub co najmniej jeden zrzut ekranu.",
  files: "Nie można dołączyć tych plików. Dodaj zrzuty ekranu ponownie.",
  duplicate: "Identyfikator prośby jest już używany.",
} as const;

type Copy = {
  title: string; hint: string; instructions: string; notify: string; request: string; busy: string;
  cancel: string; history: string; empty: string; pending: string; submitted: string; cancelled: string;
  ourRequest: string; response: string; attachments: string; reload: string; loading: string; noSubmission: string; closed: string;
  errors: Record<string, string>;
};
export const revisionCopy: Record<"pl" | "ru" | "en", Copy> = {
  pl: {
    title: "Poprawa zadania", hint: "Kandydat otrzyma instrukcje i może dosłać tekst lub zrzuty ekranu bez ponownego wypełniania formularza. Pierwotne zadanie pozostaje w historii.",
    instructions: "Instrukcje dla kandydata po polsku", notify: "Wyślij instrukcje również jako wiadomość na czacie", request: "Poproś o poprawę", busy: "Zapisywanie…",
    cancel: "Anuluj prośbę", history: "Historia poprawek", empty: "Nie wysłano jeszcze prośby o poprawę.", pending: "Oczekujemy na odpowiedź", submitted: "Odpowiedź otrzymana", cancelled: "Prośba anulowana",
    ourRequest: "Nasza prośba", response: "Odpowiedź kandydata", attachments: "Załączniki kandydata", reload: "Odśwież", loading: "Ładowanie poprawek…", noSubmission: "Prośbę można wysłać po przesłaniu zadania.", closed: "Prośby są niedostępne po opublikowaniu odmowy.",
    errors: { revision_pending: revisionErrors.pending, revision_inactive: revisionErrors.inactive, revision_changed: revisionErrors.changed, revision_not_submitted: revisionErrors.notSubmitted, revision_failed: "Nie udało się zapisać lub wczytać poprawy. Spróbuj ponownie." },
  },
  ru: {
    title: "Доработка задания", hint: "Кандидат получит инструкции и сможет дослать текст или скриншоты без повторного заполнения анкеты. Исходное задание останется в истории.",
    instructions: "Инструкции для кандидата на польском", notify: "Также отправить инструкции сообщением в чат", request: "Запросить доработку", busy: "Сохранение…",
    cancel: "Отменить запрос", history: "История доработок", empty: "Запросов на доработку пока нет.", pending: "Ожидаем ответ", submitted: "Ответ получен", cancelled: "Запрос отменён",
    ourRequest: "Наш запрос", response: "Ответ кандидата", attachments: "Файлы кандидата", reload: "Обновить", loading: "Загрузка доработок…", noSubmission: "Запрос доступен после отправки задания.", closed: "После публикации отказа доработки недоступны.",
    errors: { revision_pending: "Уже есть активный запрос на доработку.", revision_inactive: "Запрос больше не активен. Обновите страницу.", revision_changed: "Кандидат уже отправил доработку. Обновите историю.", revision_not_submitted: "Кандидат ещё не отправил задание.", revision_failed: "Не удалось сохранить или загрузить доработку. Попробуйте ещё раз." },
  },
  en: {
    title: "Task revisions", hint: "The candidate receives instructions and can send corrected text or screenshots without repeating the form. The original task stays in the history.",
    instructions: "Instructions for the candidate in Polish", notify: "Also send instructions as a chat message", request: "Request revision", busy: "Saving…",
    cancel: "Cancel request", history: "Revision history", empty: "No revisions requested yet.", pending: "Awaiting response", submitted: "Response received", cancelled: "Request cancelled",
    ourRequest: "Our request", response: "Candidate response", attachments: "Candidate attachments", reload: "Refresh", loading: "Loading revisions…", noSubmission: "A revision can be requested after the task is submitted.", closed: "Revisions are unavailable after publishing a refusal.",
    errors: { revision_pending: "There is already an active revision request.", revision_inactive: "This request is no longer active. Refresh the page.", revision_changed: "The candidate already submitted a revision. Refresh the history.", revision_not_submitted: "The candidate has not submitted the task yet.", revision_failed: "Could not save or load the revision. Try again." },
  },
};
