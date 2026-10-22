type InboxCopy = {
  all: string; needsReply: string; filter: string; hint: string; oldestFirst: string;
  empty: string; waiting: (minutes: number) => string; attachment: string; latest: string;
  quick: {
    title: string; hint: string; select: string; manage: string; loading: string; loadFailed: string;
    empty: string; add: string; remove: string; name: string; body: string; save: string; saving: string;
    saved: string; reload: string; changed: string; invalid: string; tooLong: string; limit: string;
  };
};
export const inboxCopy: Record<"pl" | "ru" | "en", InboxCopy> = {
  pl: {
    all: "Wszyscy kandydaci", needsReply: "Wymaga odpowiedzi", filter: "Kolejka rozmów",
    hint: "Wiadomość kandydata czeka na odpowiedź administratora. Automatyczna wiadomość nie zamyka kolejki.",
    oldestFirst: "Najdłużej oczekujące na początku", empty: "Wszystkie wiadomości mają odpowiedź.",
    waiting: n => n < 1 ? "Oczekuje krócej niż minutę" : n < 60 ? `Oczekuje ${n} min` : `Oczekuje ${Math.floor(n / 60)} godz. ${n % 60} min`,
    attachment: "Załącznik", latest: "Ostatnia wiadomość kandydata",
    quick: {
      title: "Szybkie odpowiedzi", hint: "Wspólne szablony dla administratorów. Treść pozostaje po polsku. Wybór tylko wstawia tekst — wiadomość wysyłasz samodzielnie.",
      select: "Wstaw szybką odpowiedź…", manage: "Edytuj szablony", loading: "Ładowanie szablonów…", loadFailed: "Nie udało się wczytać szablonów.",
      empty: "Brak zapisanych odpowiedzi.", add: "Dodaj odpowiedź", remove: "Usuń szablon", name: "Nazwa szablonu", body: "Treść wiadomości po polsku",
      save: "Zapisz odpowiedzi", saving: "Zapisywanie…", saved: "Szybkie odpowiedzi zapisane.", reload: "Wczytaj ponownie",
      changed: "Inny administrator zmienił szablony. Skopiuj swoje zmiany i wczytaj aktualną wersję przed zapisem.",
      invalid: "Uzupełnij nazwę i treść każdej odpowiedzi.", tooLong: "Tekst razem z szablonem przekroczyłby limit 4000 znaków. Skróć wiadomość przed wstawieniem.", limit: "Można zapisać maksymalnie 12 odpowiedzi.",
    },
  },
  ru: {
    all: "Все лиды", needsReply: "Требует ответа", filter: "Очередь чатов",
    hint: "Сообщение кандидата ждёт ответа администратора. Автоматическое сообщение не закрывает очередь.",
    oldestFirst: "Сначала те, кто ждёт дольше", empty: "Все сообщения получили ответ.",
    waiting: n => n < 1 ? "Ждёт меньше минуты" : n < 60 ? `Ждёт ${n} мин` : `Ждёт ${Math.floor(n / 60)} ч ${n % 60} мин`,
    attachment: "Вложение", latest: "Последнее сообщение кандидата",
    quick: {
      title: "Быстрые ответы", hint: "Общие шаблоны для администраторов. Тексты остаются на польском. Выбор только вставляет текст — сообщение отправляете вы.",
      select: "Вставить быстрый ответ…", manage: "Редактировать шаблоны", loading: "Загрузка шаблонов…", loadFailed: "Не удалось загрузить шаблоны.",
      empty: "Сохранённых ответов пока нет.", add: "Добавить ответ", remove: "Удалить шаблон", name: "Название шаблона", body: "Текст сообщения на польском",
      save: "Сохранить ответы", saving: "Сохранение…", saved: "Быстрые ответы сохранены.", reload: "Загрузить заново",
      changed: "Другой администратор изменил шаблоны. Скопируйте свои правки и загрузите актуальную версию перед сохранением.",
      invalid: "Заполните название и текст каждого ответа.", tooLong: "Текст вместе с шаблоном превысит лимит 4000 символов. Сократите сообщение перед вставкой.", limit: "Можно сохранить не более 12 ответов.",
    },
  },
  en: {
    all: "All leads", needsReply: "Needs reply", filter: "Conversation queue",
    hint: "A candidate's message is waiting for an administrator. Automatic messages do not clear the queue.",
    oldestFirst: "Longest waiting first", empty: "All messages have been answered.",
    waiting: n => n < 1 ? "Waiting less than a minute" : n < 60 ? `Waiting ${n} min` : `Waiting ${Math.floor(n / 60)} h ${n % 60} min`,
    attachment: "Attachment", latest: "Latest candidate message",
    quick: {
      title: "Quick replies", hint: "Shared templates for administrators. Message text stays in Polish. Selecting a template only inserts text — you send the message yourself.",
      select: "Insert a quick reply…", manage: "Edit templates", loading: "Loading templates…", loadFailed: "Could not load templates.",
      empty: "No saved replies yet.", add: "Add reply", remove: "Delete template", name: "Template name", body: "Message text in Polish",
      save: "Save replies", saving: "Saving…", saved: "Quick replies saved.", reload: "Reload",
      changed: "Another administrator changed the templates. Copy your edits and reload the current version before saving.",
      invalid: "Fill in the name and message for each reply.", tooLong: "Your draft and the template would exceed 4000 characters. Shorten the message before inserting.", limit: "You can save up to 12 replies.",
    },
  },
};
