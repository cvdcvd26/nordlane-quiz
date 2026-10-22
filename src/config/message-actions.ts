type Labels = {
  edit: string; remove: string; editTitle: string; deleteTitle: string; deleteHint: string;
  body: string; filesHint: string; cancel: string; save: string; working: string; conflict: string;
};
export const messageActionCopy: Record<"pl" | "ru" | "en", Labels> = {
  pl: {
    edit: "Edytuj", remove: "Usuń", editTitle: "Edytuj wiadomość", deleteTitle: "Usunąć wiadomość?",
    deleteHint: "Wiadomość i jej załączniki znikną z obu stron rozmowy. Tej operacji nie można cofnąć.",
    body: "Treść wiadomości", filesHint: "Edycja zmienia tylko tekst. Załączniki pozostają w wiadomości.",
    cancel: "Anuluj", save: "Zapisz", working: "Zapisywanie…", conflict: "Wiadomość została zmieniona przez innego administratora. Skopiuj swoje poprawki, zamknij okno i otwórz edycję ponownie.",
  },
  ru: {
    edit: "Изменить", remove: "Удалить", editTitle: "Редактирование сообщения", deleteTitle: "Удалить сообщение?",
    deleteHint: "Сообщение и его вложения исчезнут у обеих сторон чата. Отменить удаление нельзя.",
    body: "Текст сообщения", filesHint: "Редактирование меняет только текст. Вложения останутся в сообщении.",
    cancel: "Отмена", save: "Сохранить", working: "Сохранение…", conflict: "Другой администратор уже изменил сообщение. Скопируйте свои правки, закройте окно и откройте редактирование заново.",
  },
  en: {
    edit: "Edit", remove: "Delete", editTitle: "Edit message", deleteTitle: "Delete this message?",
    deleteHint: "The message and its attachments will disappear from both sides of the conversation. This cannot be undone.",
    body: "Message text", filesHint: "Editing only changes the text. Attachments stay in the message.",
    cancel: "Cancel", save: "Save", working: "Saving…", conflict: "Another administrator has changed the message. Copy your edits, close this window and open the editor again.",
  },
};
