type Copy = {
  unfinished: string; unfinishedBadge: string; unfinishedHint: string; stage: string; allStages: string; questions: string; task: string;
  inactive: string; anyActivity: string; minutes: (n: number) => string; oldestActivity: string;
  active: string; lastActive: string; dialogs: string; close: string; search: string; all: string; empty: string;
  previous: string; next: string; loading: string; retry: string; draftWarning: string;
};
export const workflowCopy: Record<"pl" | "ru" | "en", Copy> = {
  pl: {
    unfinishedBadge: "Nieukończone zgłoszenie",
    unfinished: "Niedokończone zgłoszenia", unfinishedHint: "Kandydaci z zapisanym kontaktem, którzy nie wysłali zadania. Domyślnie: brak aktywności od 30 minut. Licznik obejmuje wszystkie etapy przy tym progu; zakończone i odrzucone zgłoszenia są pomijane.",
    stage: "Etap", allStages: "Wszystkie etapy", questions: "Pytania", task: "Zadanie", inactive: "Brak aktywności", anyActivity: "Także aktywni", minutes: n => `Od ${n} min`, oldestActivity: "Najdłużej nieaktywni", active: "Aktywny ostatnio", lastActive: "Ostatnia aktywność", dialogs: "Rozmowy", close: "Zamknij listę rozmów", search: "Szukaj kandydata…", all: "Wszyscy", empty: "Brak pasujących rozmów.", previous: "Poprzednia", next: "Następna", loading: "Ładowanie…", retry: "Spróbuj ponownie", draftWarning: "Masz niezapisane zmiany lub niewysłane wiadomości. Opuścić tę stronę?",
  },
  ru: {
    unfinishedBadge: "Не завершил заявку",
    unfinished: "Не завершили заявку", unfinishedHint: "Кандидаты сохранили контакты, но не отправили задание. По умолчанию — неактивны от 30 минут. Счётчик включает все этапы при этом пороге; завершённые и отклонённые лиды исключены.",
    stage: "Этап", allStages: "Все этапы", questions: "Вопросы", task: "Задание", inactive: "Нет активности", anyActivity: "Включая активных", minutes: n => `От ${n} мин`, oldestActivity: "Сначала давно неактивные", active: "Недавно активен", lastActive: "Последняя активность", dialogs: "Диалоги", close: "Закрыть список диалогов", search: "Найти кандидата…", all: "Все", empty: "Подходящих диалогов нет.", previous: "Назад", next: "Далее", loading: "Загрузка…", retry: "Повторить", draftWarning: "Есть несохранённые изменения или неотправленные сообщения. Покинуть эту страницу?",
  },
  en: {
    unfinishedBadge: "Application unfinished",
    unfinished: "Unfinished applications", unfinishedHint: "Candidates saved their contact details but have not submitted the task. Default: inactive for 30 minutes. The badge includes all stages at that threshold; completed and rejected leads are excluded.",
    stage: "Stage", allStages: "All stages", questions: "Questions", task: "Task", inactive: "Inactive for", anyActivity: "Include active candidates", minutes: n => `At least ${n} min`, oldestActivity: "Longest inactive first", active: "Recently active", lastActive: "Last activity", dialogs: "Conversations", close: "Close conversation list", search: "Find a candidate…", all: "All", empty: "No matching conversations.", previous: "Previous", next: "Next", loading: "Loading…", retry: "Retry", draftWarning: "You have unsaved changes or unsent messages. Leave this page?",
  },
};
