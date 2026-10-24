export const analyticsConfig = {
  heartbeatIntervalMs: 30_000,
  maxRangeDays: 366,
  maxSourceGroups: 30,
  maxTagLength: 120,
  timeZone: "Europe/Warsaw",
} as const;

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "custom";
export type FunnelCounts = { sessions: number; contacts: number; questions: number; taskViewed: number; submitted: number };
export type AnalyticsSource = FunnelCounts & {
  kind: "utm" | "referrer" | "direct" | "unknown" | "other";
  source: string | null;
  medium: string | null;
  campaign: string | null;
};
export type AnalyticsReport = {
  range: { from: string; to: string; timezone: "Europe/Warsaw" };
  generatedAt: string;
  totals: FunnelCounts & { attributed: number; active: number };
  sources: AnalyticsSource[];
};

type Copy = {
  title: string; description: string; period: string; periods: Record<AnalyticsPeriod, string>;
  from: string; to: string; apply: string; refresh: string; loading: string; failed: string;
  empty: string; sessions: string; contacts: string; questions: string; taskViewed: string;
  submitted: string; coverage: string; active: string; ofCohort: string; sources: string;
  source: string; medium: string; campaign: string; conversion: string; direct: string;
  unknown: string; other: string; untagged: string; dateHint: string; cohortHint: string;
  sourceHint: string; taskHint: string; activityHint: string; privacyHint: string; updated: string;
  rangeError: string; zoneLabel: string;
};

export const analyticsCopy: Record<"pl" | "ru" | "en", Copy> = {
  pl: {
    title: "Analityka", description: "Od pierwszej sesji przeglądarki do przesłanego zadania.",
    period: "Okres", periods: { "7d": "Ostatnie 7 dni", "30d": "Ostatnie 30 dni", "90d": "Ostatnie 90 dni", custom: "Własny zakres" },
    from: "Od", to: "Do", apply: "Zastosuj", refresh: "Odśwież", loading: "Wczytywanie analityki…",
    failed: "Nie udało się wczytać analityki. Spróbuj ponownie.", empty: "W tym okresie nie utworzono żadnej sesji.",
    sessions: "Sesje", contacts: "Kontakt zapisany", questions: "3 odpowiedzi zapisane", taskViewed: "Zadanie wyświetlone",
    submitted: "Zadanie przesłane", coverage: "Sesje ze zgodą na źródło", active: "Aktywne teraz", ofCohort: "wybranych sesji",
    sources: "Źródła ruchu", source: "Źródło", medium: "Medium", campaign: "Kampania", conversion: "Przesłane / sesje",
    direct: "Bezpośrednio", unknown: "Nieznane / brak zgody", other: "Pozostałe źródła", untagged: "Bez utm_source",
    dateHint: "Dni kalendarzowe w Polsce (Europe/Warsaw), maksymalnie 366 dni. Data „Do” jest wliczona; zmiana czasu jest uwzględniana automatycznie.",
    cohortHint: "Wszystkie liczby i procenty dotyczą sesji utworzonych w wybranym okresie. Etapy pokazują ich aktualny stan, także gdy ukończono je później. Sesja oznacza przeglądarkę z plikiem cookie, a nie unikalną osobę.",
    sourceHint: "Pierwsze źródło zapisujemy po zgodzie na wszystkie pliki cookie. Brak zgody, wycofanie zgody i starsze sesje trafiają do „Nieznane”. Tabela pokazuje do 29 grup źródło / medium / kampania i sumę pozostałych; wszystkie grupy razem obejmują cały wybrany zbiór.",
    taskHint: "Wyświetlenia zadania mierzymy od uruchomienia tej funkcji, po potwierdzeniu kontaktu i 3 odpowiedzi. Starsze przesłane zadania mogą nie mieć zarejestrowanego wyświetlenia. Kontakt, odpowiedzi i przesłanie wynikają z zapisów w bazie.",
    activityHint: "Aktywne: ostatnia aktywność w ciągu 2 minut. Widoczna karta odświeża aktywność co 30 sekund; jest to sygnał orientacyjny.",
    privacyHint: "Bez usług śledzących i identyfikatorów reklamowych. Przy zgodzie zapisujemy tylko parametry UTM i host strony odsyłającej. Wycofanie zgody usuwa te dane z bieżącej sesji.",
    updated: "Dane z", rangeError: "Wybierz poprawny zakres do 366 dni, nie późniejszy niż dzisiaj według czasu w Polsce.", zoneLabel: "Czas w Polsce (Europe/Warsaw)",
  },
  ru: {
    title: "Аналитика", description: "От первого сеанса браузера до отправленного задания.",
    period: "Период", periods: { "7d": "Последние 7 дней", "30d": "Последние 30 дней", "90d": "Последние 90 дней", custom: "Свой период" },
    from: "С", to: "По", apply: "Применить", refresh: "Обновить", loading: "Загрузка аналитики…",
    failed: "Не удалось загрузить аналитику. Попробуйте ещё раз.", empty: "За этот период новые сеансы не создавались.",
    sessions: "Сеансы", contacts: "Контакт сохранён", questions: "3 ответа сохранены", taskViewed: "Задание просмотрено",
    submitted: "Задание отправлено", coverage: "Сеансы с согласием на источник", active: "Активны сейчас", ofCohort: "выбранных сеансов",
    sources: "Источники трафика", source: "Источник", medium: "Канал", campaign: "Кампания", conversion: "Отправлено / сеансы",
    direct: "Прямой переход", unknown: "Неизвестно / нет согласия", other: "Другие источники", untagged: "Без utm_source",
    dateHint: "Календарные дни в Польше (Europe/Warsaw), не более 366 дней. Конечная дата включена; перевод часов учитывается автоматически.",
    cohortHint: "Все числа и проценты относятся к сеансам, созданным в выбранный период. Этапы отражают их текущее состояние, в том числе завершённые позже. Сеанс — браузер с cookie, а не уникальный человек.",
    sourceHint: "Первый источник сохраняется после согласия на все cookie. Сеансы без согласия, с отозванным согласием и старые сеансы относятся к «Неизвестно». Таблица содержит до 29 групп источник / канал / кампания и сумму остальных; вместе они охватывают всю выборку.",
    taskHint: "Просмотры задания учитываются с запуска этой функции, после проверки контакта и 3 ответов. У старых отправленных заданий просмотр может отсутствовать. Контакт, ответы и отправка подтверждаются записями в базе.",
    activityHint: "Активны: последняя активность в течение 2 минут. Видимая вкладка обновляет активность каждые 30 секунд; это ориентировочный сигнал.",
    privacyHint: "Без внешних трекеров и рекламных идентификаторов. При согласии сохраняются только UTM и хост источника перехода. Отзыв согласия удаляет эти данные текущего сеанса.",
    updated: "Данные на", rangeError: "Выберите корректный период до 366 дней, не позже сегодняшнего дня по времени Польши.", zoneLabel: "Время Польши (Europe/Warsaw)",
  },
  en: {
    title: "Analytics", description: "From a browser’s first session to a submitted task.",
    period: "Period", periods: { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", custom: "Custom range" },
    from: "From", to: "To", apply: "Apply", refresh: "Refresh", loading: "Loading analytics…",
    failed: "Could not load analytics. Please try again.", empty: "No sessions were created in this period.",
    sessions: "Sessions", contacts: "Contact saved", questions: "3 answers saved", taskViewed: "Task viewed",
    submitted: "Task submitted", coverage: "Sessions with source consent", active: "Active now", ofCohort: "of selected sessions",
    sources: "Traffic sources", source: "Source", medium: "Medium", campaign: "Campaign", conversion: "Submitted / sessions",
    direct: "Direct", unknown: "Unknown / no consent", other: "Other sources", untagged: "No utm_source",
    dateHint: "Calendar days in Poland (Europe/Warsaw), up to 366 days. The end date is included; daylight saving changes are applied automatically.",
    cohortHint: "Every count and percentage uses sessions created in the selected period. Milestones reflect their current state, including steps completed later. A session means a browser with a cookie, not a unique person.",
    sourceHint: "The first source is recorded after consent to all cookies. Missing consent, withdrawn consent and older sessions appear as Unknown. The table shows up to 29 source / medium / campaign groups plus the remaining total; together they cover the whole selected cohort.",
    taskHint: "Task views are measured from this feature’s launch, after confirming a contact and 3 answers. Older submissions may have no recorded task view. Contact, answers and submission come from saved database records.",
    activityHint: "Active: last activity within 2 minutes. A visible tab refreshes activity every 30 seconds; this is an approximate signal.",
    privacyHint: "No third-party trackers or advertising IDs. With consent, only UTM parameters and the referring host are saved. Withdrawal removes these values from the current session.",
    updated: "Data as of", rangeError: "Choose a valid range of up to 366 days, ending no later than today in Poland.", zoneLabel: "Poland time (Europe/Warsaw)",
  },
};
