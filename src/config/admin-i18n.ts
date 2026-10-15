/**
 * Admin panel copy in three languages. Polish is the source (src/config/content.ts);
 * Russian and English must have exactly the same shape — TypeScript checks it.
 * The visitor-facing site stays Polish.
 */
import { content } from "./content";

/** Turns the `as const` literal types of content.ts into plain strings so translations can differ. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : T extends object
        ? { -readonly [K in keyof T]: Widen<T[K]> }
        : T;

export type AdminDict = {
  locale: string;
  langName: string;
  langSwitch: string;
  ui: Widen<typeof content.admin>;
  errors: Widen<typeof content.errors>;
  chat: Widen<typeof content.chat>;
};

export const ADMIN_LANGS = ["pl", "ru", "en"] as const;
export type AdminLang = (typeof ADMIN_LANGS)[number];
export const isAdminLang = (v: unknown): v is AdminLang => ADMIN_LANGS.includes(v as AdminLang);

const pl: AdminDict = {
  locale: "pl-PL",
  langName: "PL",
  langSwitch: "Język panelu",
  ui: content.admin,
  errors: content.errors,
  chat: content.chat,
};

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

const ru: AdminDict = {
  locale: "ru-RU",
  langName: "RU",
  langSwitch: "Язык панели",
  ui: {
    title: "Nordlane · Панель",
    nav: { leads: "Лиды", settings: "Настройки", sections: "Разделы", logout: "Выйти" },
    login: {
      title: "Вход в панель",
      email: "E-mail",
      password: "Пароль",
      submit: "Войти",
      submitting: "Вход…",
      invalid: "Неверный e-mail или пароль.",
      invalidEmail: "Неверный e-mail.",
    },
    list: {
      title: "Лиды",
      total: (n) => `Всего: ${n}`,
      search: "Поиск",
      searchPlaceholder: "Поиск по ID, имени, телефону, отзыву, сообщениям и заметкам",
      status: "Статус",
      allStatuses: "Все статусы",
      newestFirst: "Сначала новые",
      oldestFirst: "Сначала старые",
      columns: {
        id: "ID",
        stage: "Этап",
        created: "Создан",
        status: "Статус",
        answer: "Ответы",
        contact: "Контакт",
        lastMessage: "Последнее сообщение",
        messages: "Сообщений",
      },
      noResults: "Ничего не найдено. Измените поиск или фильтр.",
      empty: "Лидов пока нет. Лид появляется, когда пользователь оставляет контакты на первом экране.",
      selectAll: "Выбрать все на странице",
      selectOne: (id) => `Выбрать лид #${id}`,
      selected: (n) => `Выбрано: ${n}`,
      deleteSelected: "Удалить выбранные",
      clearSelection: "Снять выбор",
      confirmDeleteMany: (n) =>
        `Удалить ${n} ${plural(n, "лид", "лида", "лидов")} навсегда? Будут удалены контакты, ответы, файлы и переписка.`,
      deleted: (n) => `Удалено: ${n}`,
      confirmYes: "Да, удалить",
      cancel: "Отмена",
      pages: "Страницы",
      prev: "Назад",
      next: "Вперёд",
      pageOf: (page, total) => `${page} из ${total}`,
    },
    lead: {
      back: "← Все лиды",
      toList: "К списку",
      title: (id) => `Лид #${id}`,
      status: "Статус",
      meta: (created, updated, count) => `Создан ${created} · обновлён ${updated} · сообщений: ${count}`,
      thread: "Переписка",
      noMessages: "Сообщений нет.",
      replyPlaceholder: "Ответ пользователю…",
      contact: "Контакт",
      contactName: "Имя",
      contactPhone: "Телефон",
      contactTelegram: "Telegram",
      answers: "Ответы",
      submission: "Задание",
      submittedAt: (t) => `Отправлено ${t}`,
      review: "Отзыв",
      noReview: "Пользователь не написал отзыв.",
      autoMessage: "Автосообщение",
      autoStatus: {
        pending: "запланировано",
        sending: "отправляется",
        sent: "отправлено",
        failed: "ошибка",
        cancelled: "отменено",
      },
      autoAt: (t) => `на ${t}`,
      notes: "Внутренние заметки",
      notesHint: "Видны только администратору.",
      newNote: "Новая заметка",
      addNote: "Добавить заметку",
      notFound: "Лид не найден.",
      noteEmpty: "Заметка пустая.",
      conversationNotFound: "Переписка не найдена.",
      stage: "Этап",
      delete: "Удалить лид",
      deleting: "Удаление…",
      confirmDelete: (id) =>
        `Удалить лид #${id} навсегда? Будут удалены контакт, ответы, файлы и переписка. Это действие нельзя отменить.`,
      noSubmissionYet: "Пользователь ещё не отправил задание. Написать можно уже сейчас — он увидит сообщение после отправки задания.",
    },
    stages: { contact: "Контакт", questions: "Вопросы", submitted: "Задание отправлено" },
    notify: {
      newLead: (id, name) => `Новый лид #${id}${name ? ` · ${name}` : ""}`,
      newMessage: (id, name) => `Новое сообщение · лид #${id}${name ? ` · ${name}` : ""}`,
      open: "Открыть",
      close: "Закрыть уведомление",
      soundOn: "Звук включён",
      soundOff: "Звук выключен",
    },
    settings: {
      title: "Автосообщение",
      intro: "Отправляется в чат после отправки задания, через случайное время. В чате помечено как автоматическое.",
      enabled: "Отправлять автосообщение",
      text: "Текст сообщения",
      delayFrom: "Задержка от, мин",
      delayTo: "до, мин",
      delayHint: "Новый интервал действует для заданий, отправленных после сохранения.",
      delayOrder: "Максимальная задержка не может быть меньше минимальной.",
      chat: "Чат",
      attachments: "Разрешить пользователям прикреплять файлы",
      save: "Сохранить настройки",
      saving: "Сохранение…",
      saved: "Настройки сохранены.",
      password: {
        title: "Сменить пароль",
        current: "Текущий пароль",
        next: "Новый пароль (мин. 10 символов)",
        repeat: "Повторите новый пароль",
        submit: "Сменить пароль",
        mismatch: "Новые пароли не совпадают.",
        changed: "Пароль изменён. Остальные сессии завершены.",
        wrongCurrent: "Текущий пароль неверный.",
        tooShort: "Пароль должен быть не короче 10 символов.",
        tooLong: "Пароль слишком длинный.",
      },
    },
    statuses: {
      new: "Новый",
      in_progress: "В работе",
      awaiting_reply: "Ждёт ответа",
      completed: "Завершён",
      rejected: "Отклонён",
    },
    answers: { yes: "Да", no: "Нет" },
  },
  errors: {
    generic: "Что-то пошло не так. Попробуйте ещё раз.",
    network: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.",
    answerRequired: "Ответьте на все вопросы, чтобы продолжить.",
    nameRequired: "Укажите имя.",
    nameTooLong: "Имя слишком длинное.",
    phoneRequired: "Укажите номер телефона.",
    phoneInvalid: "Введите корректный номер телефона.",
    telegramInvalid: "Введите корректный ник Telegram (5–32 символа: буквы, цифры, подчёркивание).",
    contactRequired: "Заполните контактные данные.",
    fixFields: "Исправьте отмеченные поля.",
    filesRequired: "Загрузите хотя бы один скриншот.",
    filesPending: "Дождитесь окончания загрузки файлов.",
    fileType: "Недопустимый тип файла.",
    fileSize: (maxMb) => `Файл больше ${maxMb} МБ.`,
    fileCount: (max) => `Можно загрузить не больше ${max} файлов.`,
    fileContent: "Содержимое файла не соответствует его типу.",
    fileMissing: "Файл не найден или уже отправлен.",
    filesMissing: "Часть файлов не найдена. Загрузите их ещё раз.",
    fileAlreadySent: "Файл уже отправлен.",
    fileNotProvided: "Файл не передан.",
    alreadySubmitted: "Задание уже отправлено.",
    attachmentsDisabled: "Вложения отключены.",
    badRequest: "Некорректный запрос.",
    unknownQuestion: "Неизвестный вопрос.",
    rateLimited: "Слишком много запросов. Подождите немного.",
    messageEmpty: "Сообщение пустое.",
    messageTooLong: "Сообщение слишком длинное.",
    notSubmitted: "Сначала отправьте задание.",
    reviewRequired: "Напишите отзыв (не меньше 10 символов).",
    reviewTooLong: "Отзыв слишком длинный.",
    sessionMissing: "Сессия не найдена. Обновите страницу.",
    unauthorized: "Требуется вход.",
    forbidden: "Нет доступа.",
    notFound: "Не найдено.",
  },
  chat: {
    title: "Чат",
    waiting: "Здесь появятся сообщения.",
    placeholder: "Напишите сообщение…",
    send: "Отправить",
    attach: "Прикрепить файл",
    removeAttachment: (name) => `Удалить ${name}`,
    soundOn: "Выключить звук уведомлений",
    soundOff: "Включить звук уведомлений",
    sending: "Отправка…",
    failed: "Не отправлено",
    retry: "Повторить",
    systemLabel: "Автосообщение",
    adminLabel: "Nordlane",
    youLabel: "Вы",
    visitorLabel: "Пользователь",
    offline: "Нет связи. Попробуем снова автоматически.",
  },
};

const en: AdminDict = {
  locale: "en-GB",
  langName: "EN",
  langSwitch: "Panel language",
  ui: {
    title: "Nordlane · Panel",
    nav: { leads: "Leads", settings: "Settings", sections: "Sections", logout: "Log out" },
    login: {
      title: "Sign in to the panel",
      email: "Email",
      password: "Password",
      submit: "Sign in",
      submitting: "Signing in…",
      invalid: "Wrong email or password.",
      invalidEmail: "Invalid email.",
    },
    list: {
      title: "Leads",
      total: (n) => `Total: ${n}`,
      search: "Search",
      searchPlaceholder: "Search by ID, name, phone, review, messages and notes",
      status: "Status",
      allStatuses: "All statuses",
      newestFirst: "Newest first",
      oldestFirst: "Oldest first",
      columns: {
        id: "ID",
        stage: "Stage",
        created: "Created",
        status: "Status",
        answer: "Answers",
        contact: "Contact",
        lastMessage: "Last message",
        messages: "Messages",
      },
      noResults: "Nothing found. Change the search or filter.",
      empty: "No leads yet. A lead appears when a visitor leaves contact details on the first screen.",
      selectAll: "Select all on this page",
      selectOne: (id) => `Select lead #${id}`,
      selected: (n) => `Selected: ${n}`,
      deleteSelected: "Delete selected",
      clearSelection: "Clear selection",
      confirmDeleteMany: (n) =>
        `Permanently delete ${n} ${n === 1 ? "lead" : "leads"}? Contacts, answers, files and messages will be removed.`,
      deleted: (n) => `Deleted: ${n}`,
      confirmYes: "Yes, delete",
      cancel: "Cancel",
      pages: "Pages",
      prev: "Previous",
      next: "Next",
      pageOf: (page, total) => `${page} of ${total}`,
    },
    lead: {
      back: "← All leads",
      toList: "Back to list",
      title: (id) => `Lead #${id}`,
      status: "Status",
      meta: (created, updated, count) => `Created ${created} · updated ${updated} · messages: ${count}`,
      thread: "Conversation",
      noMessages: "No messages.",
      replyPlaceholder: "Reply to the visitor…",
      contact: "Contact",
      contactName: "Name",
      contactPhone: "Phone",
      contactTelegram: "Telegram",
      answers: "Answers",
      submission: "Task",
      submittedAt: (t) => `Submitted ${t}`,
      review: "Review",
      noReview: "The visitor did not write a review.",
      autoMessage: "Automatic message",
      autoStatus: {
        pending: "scheduled",
        sending: "sending",
        sent: "sent",
        failed: "failed",
        cancelled: "cancelled",
      },
      autoAt: (t) => `for ${t}`,
      notes: "Internal notes",
      notesHint: "Visible to the admin only.",
      newNote: "New note",
      addNote: "Add note",
      notFound: "Lead not found.",
      noteEmpty: "The note is empty.",
      conversationNotFound: "Conversation not found.",
      stage: "Stage",
      delete: "Delete lead",
      deleting: "Deleting…",
      confirmDelete: (id) =>
        `Permanently delete lead #${id}? Contact, answers, files and messages will be removed. This cannot be undone.`,
      noSubmissionYet: "The visitor has not submitted the task yet. You can write now — they will see it once the task is sent.",
    },
    stages: { contact: "Contact", questions: "Questions", submitted: "Task submitted" },
    notify: {
      newLead: (id, name) => `New lead #${id}${name ? ` · ${name}` : ""}`,
      newMessage: (id, name) => `New message · lead #${id}${name ? ` · ${name}` : ""}`,
      open: "Open",
      close: "Close notification",
      soundOn: "Sound on",
      soundOff: "Sound off",
    },
    settings: {
      title: "Automatic message",
      intro: "Sent to the chat after the task is submitted, after a random delay. Marked as automatic in the chat.",
      enabled: "Send the automatic message",
      text: "Message text",
      delayFrom: "Delay from, min",
      delayTo: "to, min",
      delayHint: "The new range applies to tasks submitted after saving.",
      delayOrder: "The maximum delay cannot be less than the minimum.",
      chat: "Chat",
      attachments: "Allow visitors to attach files",
      save: "Save settings",
      saving: "Saving…",
      saved: "Settings saved.",
      password: {
        title: "Change password",
        current: "Current password",
        next: "New password (min. 10 characters)",
        repeat: "Repeat new password",
        submit: "Change password",
        mismatch: "The new passwords do not match.",
        changed: "Password changed. Other sessions were signed out.",
        wrongCurrent: "The current password is wrong.",
        tooShort: "The password must be at least 10 characters.",
        tooLong: "The password is too long.",
      },
    },
    statuses: {
      new: "New",
      in_progress: "In progress",
      awaiting_reply: "Awaiting reply",
      completed: "Completed",
      rejected: "Rejected",
    },
    answers: { yes: "Yes", no: "No" },
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    network: "No connection to the server. Check your internet and try again.",
    answerRequired: "Answer all questions to continue.",
    nameRequired: "Enter a name.",
    nameTooLong: "The name is too long.",
    phoneRequired: "Enter a phone number.",
    phoneInvalid: "Enter a valid phone number.",
    telegramInvalid: "Enter a valid Telegram username (5–32 characters: letters, digits, underscore).",
    contactRequired: "Fill in the contact details.",
    fixFields: "Fix the highlighted fields.",
    filesRequired: "Upload at least one screenshot.",
    filesPending: "Wait for the files to finish uploading.",
    fileType: "File type not allowed.",
    fileSize: (maxMb) => `The file is larger than ${maxMb} MB.`,
    fileCount: (max) => `You can upload up to ${max} files.`,
    fileContent: "The file content does not match its type.",
    fileMissing: "File not found or already sent.",
    filesMissing: "Some files were not found. Upload them again.",
    fileAlreadySent: "The file has already been sent.",
    fileNotProvided: "No file provided.",
    alreadySubmitted: "The task has already been submitted.",
    attachmentsDisabled: "Attachments are disabled.",
    badRequest: "Invalid request.",
    unknownQuestion: "Unknown question.",
    rateLimited: "Too many requests. Please wait a moment.",
    messageEmpty: "The message is empty.",
    messageTooLong: "The message is too long.",
    notSubmitted: "Submit the task first.",
    reviewRequired: "Write a review (at least 10 characters).",
    reviewTooLong: "The review is too long.",
    sessionMissing: "Session not found. Reload the page.",
    unauthorized: "Sign-in required.",
    forbidden: "Access denied.",
    notFound: "Not found.",
  },
  chat: {
    title: "Chat",
    waiting: "Messages will appear here.",
    placeholder: "Write a message…",
    send: "Send",
    attach: "Attach a file",
    removeAttachment: (name) => `Remove ${name}`,
    soundOn: "Turn notification sound off",
    soundOff: "Turn notification sound on",
    sending: "Sending…",
    failed: "Not sent",
    retry: "Retry",
    systemLabel: "Automatic message",
    adminLabel: "Nordlane",
    youLabel: "You",
    visitorLabel: "Visitor",
    offline: "No connection. We will retry automatically.",
  },
};

export const adminDicts: Record<AdminLang, AdminDict> = { pl, ru, en };

/**
 * Server errors arrive in Polish. For the admin panel they are translated by finding the same
 * string in the Polish dictionary and taking the value at the same path in the chosen language.
 */
const translations = new Map<AdminLang, Map<string, string>>();
function walk(src: unknown, dst: unknown, out: Map<string, string>) {
  if (typeof src === "string" && typeof dst === "string") out.set(src, dst);
  else if (src && dst && typeof src === "object" && typeof dst === "object")
    for (const k of Object.keys(src)) walk((src as Record<string, unknown>)[k], (dst as Record<string, unknown>)[k], out);
}

export function translateServerMessage(message: string, lang: AdminLang) {
  if (lang === "pl") return message;
  let map = translations.get(lang);
  if (!map) {
    map = new Map();
    walk({ ui: pl.ui, errors: pl.errors }, { ui: adminDicts[lang].ui, errors: adminDicts[lang].errors }, map);
    translations.set(lang, map);
  }
  return map.get(message) ?? message;
}
