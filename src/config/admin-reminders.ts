import type { AdminLang } from "./admin-i18n";

export type ReminderCopy = {
  title: string; hint: string; leadHint: string; all: string; due: string; upcoming: string; done: string;
  add: string; body: string; deadline: string; zone: string; save: string; saving: string; cancel: string;
  edit: string; complete: string; reopen: string; remove: string; confirmRemove: string; empty: string;
  loading: string; reload: string; saved: string; deleted: string; changed: string; invalid: string;
  invalidTime: string; repeatedTime: string; chooseTime: string; earlier: string; later: string;
  openLead: string; overdue: string; previous: string; next: string; page: (from: number, to: number, total: number) => string;
  dueToast: (id: number) => string; outstanding: (n: number) => string; error: string;
};
export const reminderCopy: Record<AdminLang, ReminderCopy> = {
  pl: {
    title: "Przypomnienia", hint: "Wspólna lista zadań administratorów. Terminy są według czasu w Warszawie. Powiadomienia i dźwięk działają, gdy panel jest otwarty.",
    leadHint: "Wspólne zadania dla tego kandydata. Wszystkie terminy są według czasu w Warszawie.",
    all: "Wszystkie", due: "Do zrobienia teraz", upcoming: "Nadchodzące", done: "Wykonane",
    add: "Dodaj przypomnienie", body: "Co trzeba zrobić?", deadline: "Termin", zone: "Czas w Warszawie (Europe/Warsaw); zmiana czasu uwzględniana automatycznie.",
    save: "Zapisz", saving: "Zapisywanie…", cancel: "Anuluj", edit: "Edytuj", complete: "Oznacz jako wykonane", reopen: "Otwórz ponownie",
    remove: "Usuń", confirmRemove: "Potwierdź usunięcie", empty: "Brak przypomnień w tej grupie.", loading: "Ładowanie przypomnień…", reload: "Odśwież",
    saved: "Przypomnienie zapisane.", deleted: "Przypomnienie usunięte.", changed: "Inny administrator zmienił to przypomnienie. Skopiuj swoje zmiany, odśwież listę i otwórz ponownie edycję.",
    invalid: "Wpisz treść (maks. 500 znaków) i poprawny termin.", invalidTime: "Ta godzina nie istnieje w Warszawie lub data jest nieprawidłowa. Wybierz inny termin.",
    repeatedTime: "Ta godzina występuje dwa razy podczas zmiany czasu. Wybierz właściwy termin.", chooseTime: "Wybierz wystąpienie godziny", earlier: "Pierwsze (czas letni, UTC+02)", later: "Drugie (czas zimowy, UTC+01)",
    openLead: "Otwórz kandydata", overdue: "Termin minął", previous: "Poprzednia", next: "Następna", page: (from, to, total) => `${from}–${to} z ${total}`,
    dueToast: id => `Przypomnienie: kandydat #${id}`, outstanding: n => `Przypomnienia do wykonania: ${n}`, error: "Nie udało się wczytać lub zapisać przypomnień. Spróbuj ponownie.",
  },
  ru: {
    title: "Напоминания", hint: "Общий список задач администраторов. Сроки указаны по времени Варшавы. Уведомления и звук работают, пока панель открыта.",
    leadHint: "Общие задачи по этому кандидату. Все сроки указаны по времени Варшавы.",
    all: "Все", due: "Сделать сейчас", upcoming: "Предстоящие", done: "Выполненные",
    add: "Добавить напоминание", body: "Что нужно сделать?", deadline: "Срок", zone: "Время Варшавы (Europe/Warsaw); переход на летнее и зимнее время учитывается автоматически.",
    save: "Сохранить", saving: "Сохранение…", cancel: "Отмена", edit: "Изменить", complete: "Отметить выполненным", reopen: "Открыть заново",
    remove: "Удалить", confirmRemove: "Подтвердить удаление", empty: "В этой группе пока нет напоминаний.", loading: "Загрузка напоминаний…", reload: "Обновить",
    saved: "Напоминание сохранено.", deleted: "Напоминание удалено.", changed: "Другой администратор изменил напоминание. Скопируйте свои правки, обновите список и откройте редактор заново.",
    invalid: "Введите текст (до 500 символов) и правильный срок.", invalidTime: "Такого времени в Варшаве не существует или дата некорректна. Выберите другой срок.",
    repeatedTime: "При переводе часов это время повторяется дважды. Выберите нужный вариант.", chooseTime: "Выберите вариант времени", earlier: "Первый (летнее время, UTC+02)", later: "Второй (зимнее время, UTC+01)",
    openLead: "Открыть кандидата", overdue: "Срок наступил", previous: "Назад", next: "Далее", page: (from, to, total) => `${from}–${to} из ${total}`,
    dueToast: id => `Напоминание: кандидат #${id}`, outstanding: n => `Напоминаний к выполнению: ${n}`, error: "Не удалось загрузить или сохранить напоминания. Попробуйте ещё раз.",
  },
  en: {
    title: "Reminders", hint: "Shared tasks for administrators. Deadlines use Warsaw time. In-app alerts and sound work while the admin panel is open.",
    leadHint: "Shared tasks for this candidate. All deadlines use Warsaw time.",
    all: "All", due: "Due now", upcoming: "Upcoming", done: "Completed",
    add: "Add reminder", body: "What needs to be done?", deadline: "Deadline", zone: "Warsaw time (Europe/Warsaw); daylight saving changes are applied automatically.",
    save: "Save", saving: "Saving…", cancel: "Cancel", edit: "Edit", complete: "Mark complete", reopen: "Reopen",
    remove: "Delete", confirmRemove: "Confirm deletion", empty: "No reminders in this group.", loading: "Loading reminders…", reload: "Refresh",
    saved: "Reminder saved.", deleted: "Reminder deleted.", changed: "Another administrator changed this reminder. Copy your edits, refresh the list, and reopen the editor.",
    invalid: "Enter reminder text (up to 500 characters) and a valid deadline.", invalidTime: "This Warsaw time does not exist, or the date is invalid. Choose another deadline.",
    repeatedTime: "This time occurs twice when the clocks change. Choose the intended occurrence.", chooseTime: "Choose the time occurrence", earlier: "First (summer time, UTC+02)", later: "Second (winter time, UTC+01)",
    openLead: "Open candidate", overdue: "Due", previous: "Previous", next: "Next", page: (from, to, total) => `${from}–${to} of ${total}`,
    dueToast: id => `Reminder: candidate #${id}`, outstanding: n => `${n} reminders need attention`, error: "Could not load or save reminders. Try again.",
  },
};
