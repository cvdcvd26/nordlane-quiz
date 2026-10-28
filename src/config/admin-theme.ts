export type AdminTheme = "dark" | "light";

export const ADMIN_THEME_STORAGE_KEY = "nl-admin-theme";
const DEFAULT_ADMIN_THEME: AdminTheme = "dark";
const listeners = new Set<() => void>();
let current: AdminTheme | null = null;
let pageOnlyChoice = false;

const normalizeTheme = (value: string | null): AdminTheme => value === "light" ? "light" : DEFAULT_ADMIN_THEME;

function readStoredTheme(): AdminTheme {
  if (typeof window === "undefined") return DEFAULT_ADMIN_THEME;
  try {
    return normalizeTheme(window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY));
  } catch {
    return current ?? DEFAULT_ADMIN_THEME;
  }
}

/** Server rendering and the first hydration pass always agree on the dark default. */
export const getServerAdminThemeSnapshot = (): AdminTheme => DEFAULT_ADMIN_THEME;

export function getAdminThemeSnapshot(): AdminTheme {
  if (typeof window === "undefined") return DEFAULT_ADMIN_THEME;
  return (current ??= readStoredTheme());
}

function receiveStorageChange(event: StorageEvent) {
  if (event.key !== ADMIN_THEME_STORAGE_KEY && event.key !== null) return;
  // Session storage can emit the same event; it must not change the admin preference.
  try {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
  } catch {
    // The event value still works if the browser blocks access to storage.
  }
  const next = normalizeTheme(event.newValue);
  pageOnlyChoice = false;
  if (current === next) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export function subscribeAdminTheme(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  if (listeners.size === 0) {
    window.addEventListener("storage", receiveStorageChange);
    // Catch a choice made in another tab while this admin shell was unmounted.
    if (!pageOnlyChoice) current = readStoredTheme();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", receiveStorageChange);
  };
}

export function setAdminTheme(theme: AdminTheme) {
  if (typeof window === "undefined") return;
  current = theme;
  try {
    window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, theme);
    pageOnlyChoice = false;
  } catch {
    // A usable in-memory switch remains available when storage is blocked or full.
    pageOnlyChoice = true;
  }
  listeners.forEach((listener) => listener());
}
