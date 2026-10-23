export const adminAccountUpdatedEvent = "alleybiz-admin-account-updated";

type Copy = {
  title: string; intro: string; email: string; emailHint: string; save: string; saving: string;
  saved: string; emailUsed: string; differentPassword: string; failed: string; network: string;
  loadError: string; retry: string;
};

export const adminAccountCopy: Record<"pl" | "ru" | "en", Copy> = {
  pl: {
    title: "Dostęp głównego administratora",
    intro: "Zmień e-mail i hasło do tego konta. Dotychczasowe dane logowania przestaną działać, a pozostałe sesje zostaną zakończone. Uprawnienia, zgłoszenia i rozmowy pozostaną zachowane.",
    email: "E-mail do logowania", emailHint: "To login do panelu. Zmiana nie wymaga kodu e-mail.",
    save: "Zmień dane logowania", saving: "Zapisywanie…",
    saved: "Dane logowania zostały zmienione. Używaj nowego e-maila i hasła. Ta sesja pozostaje aktywna.",
    emailUsed: "Ten e-mail jest już używany przez innego administratora.",
    differentPassword: "Nowe hasło musi różnić się od obecnego.", failed: "Nie udało się zmienić danych logowania. Spróbuj ponownie.",
    network: "Nie udało się potwierdzić zapisu. Sprawdź połączenie; jeśli zmiana została zapisana, zaloguj się nowymi danymi.",
    loadError: "Nie udało się wczytać ustawień konta.", retry: "Spróbuj ponownie",
  },
  ru: {
    title: "Доступ главного администратора",
    intro: "Замените email и пароль этого аккаунта. Старые данные входа перестанут работать, остальные сеансы завершатся. Права, лиды и переписка сохранятся.",
    email: "Email для входа", emailHint: "Это логин в панель. Подтверждение кодом на почту не требуется.",
    save: "Заменить данные входа", saving: "Сохранение…",
    saved: "Данные входа заменены. Используйте новый email и пароль. Текущий сеанс остаётся активным.",
    emailUsed: "Этот email уже используется другим администратором.",
    differentPassword: "Новый пароль должен отличаться от текущего.", failed: "Не удалось заменить данные входа. Попробуйте ещё раз.",
    network: "Не удалось подтвердить сохранение. Проверьте соединение; если изменения сохранились, войдите с новыми данными.",
    loadError: "Не удалось загрузить настройки аккаунта.", retry: "Повторить",
  },
  en: {
    title: "Main administrator access",
    intro: "Replace this account’s email and password. The old credentials will stop working and other sessions will end. Permissions, leads and conversations will be preserved.",
    email: "Sign-in email", emailHint: "This is your panel username. No email verification code is required.",
    save: "Replace sign-in details", saving: "Saving…",
    saved: "Sign-in details updated. Use your new email and password. This session remains active.",
    emailUsed: "This email is already used by another administrator.",
    differentPassword: "Choose a password different from the current one.", failed: "Could not replace the sign-in details. Please try again.",
    network: "The save could not be confirmed. Check your connection; if the change was saved, sign in with the new details.",
    loadError: "Could not load account settings.", retry: "Retry",
  },
};
