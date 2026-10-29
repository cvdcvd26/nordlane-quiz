export const richTextCopy = {
  pl: {
    toolbar: "Formatowanie tekstu", bold: "Pogrubienie", italic: "Kursywa", underline: "Podkreślenie", link: "Wstaw lub edytuj link",
    clear: "Usuń formatowanie", undo: "Cofnij", redo: "Ponów", loading: "Ładowanie edytora…", linkTitle: "Link w wiadomości",
    url: "Adres strony", urlPlaceholder: "https://…", apply: "Zastosuj", remove: "Usuń link", cancel: "Anuluj",
    invalidUrl: "Podaj poprawny adres zaczynający się od https:// lub http://.", limit: "Przekroczono limit tekstu lub formatowania.",
    hint: "Zaznacz tekst, aby go sformatować. Linki w wiadomości będą klikalne.",
  },
  ru: {
    toolbar: "Форматирование текста", bold: "Жирный", italic: "Курсив", underline: "Подчёркивание", link: "Вставить или изменить ссылку",
    clear: "Убрать форматирование", undo: "Отменить", redo: "Повторить", loading: "Загрузка редактора…", linkTitle: "Ссылка в сообщении",
    url: "Адрес страницы", urlPlaceholder: "https://…", apply: "Применить", remove: "Удалить ссылку", cancel: "Отмена",
    invalidUrl: "Введите корректный адрес, начинающийся с https:// или http://.", limit: "Превышен лимит текста или форматирования.",
    hint: "Выделите текст, чтобы оформить его. Ссылки в сообщении будут кликабельны.",
  },
  en: {
    toolbar: "Text formatting", bold: "Bold", italic: "Italic", underline: "Underline", link: "Insert or edit link",
    clear: "Clear formatting", undo: "Undo", redo: "Redo", loading: "Loading editor…", linkTitle: "Message link",
    url: "Page address", urlPlaceholder: "https://…", apply: "Apply", remove: "Remove link", cancel: "Cancel",
    invalidUrl: "Enter a valid address starting with https:// or http://.", limit: "The text or formatting limit has been exceeded.",
    hint: "Select text to format it. Links in the message will be clickable.",
  },
} as const;
