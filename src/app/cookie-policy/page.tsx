import type { Metadata } from "next";
import Link from "next/link";
import { CookieSettingsButton } from "@/components/privacy/CookieSettingsButton";
import { LogoMark } from "@/components/ui/LogoMark";
import { Suspense } from "react";
import { CookieConsent } from "@/components/privacy/CookieConsent";
import { SiteAccessGate } from "@/components/maintenance/SiteAccessGate";

export const metadata: Metadata = {
  title: "Polityka plików cookie — AlleyBiz",
  description: "Informacje o plikach cookie, pamięci przeglądarki i zarządzaniu preferencjami w serwisie AlleyBiz.",
};

const entries = [
  ["nl_visitor", "Cookie", "Rozpoznaje Twoją sesję, przywraca postęp zgłoszenia oraz umożliwia dostęp do Twojego czatu i załączników.", "180 dni od utworzenia sesji"],
  ["ab_cookie_consent", "Cookie", "Zapamiętuje wybór dotyczący cookies i dodatkowych preferencji. Nie zawiera danych kontaktowych ani identyfikatora zgłoszenia.", "180 dni od zapisania wyboru"],
  ["nl_admin", "Cookie", "Utrzymuje sesję zalogowanego administratora. Jest ustawiany dopiero po zalogowaniu do panelu.", "12 godzin; usuwany przy wylogowaniu"],
  ["nl_review_draft", "sessionStorage", "Zachowuje roboczy tekst odpowiedzi do zadania w bieżącej karcie.", "Do zamknięcia karty lub poprawnego wysłania zadania"],
  ["nl_submit_key", "sessionStorage", "Pomaga zapobiegać podwójnemu wysłaniu tego samego zadania.", "Do zamknięcia karty lub poprawnego wysłania zadania"],
  ["nl-sound-visitor", "localStorage", "Po zgodzie na preferencje zapamiętuje ustawienie dźwięku powiadomień kandydata.", "Do wycofania zgody lub usunięcia danych przeglądarki; odczytywany przy ważnej zgodzie"],
  ["nl-sound-admin, nl-admin-lang", "localStorage", "Zapamiętują ustawienia dźwięku i języka wybrane przez administratora w panelu.", "Do usunięcia danych przeglądarki"],
];

export default function CookiePolicyPage() {
  return (
    <SiteAccessGate>
      <header className="border-b border-line bg-paper/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="AlleyBiz — strona główna">
            <LogoMark className="grid size-10 shrink-0 place-items-center rounded-xl border border-paint/30 bg-surface" />
            <span className="display relative z-10 text-lg font-bold">AlleyBiz</span>
          </Link>
          <Link href="/" className="text-sm text-ink-soft underline underline-offset-4 hover:text-paint">Wróć do zgłoszenia</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 pt-12 pb-16 sm:px-6 sm:pt-16">
        <p className="chip"><span className="chip-dot" />Prywatność</p>
        <h1 className="display mt-6 text-4xl font-semibold sm:text-5xl">Polityka plików cookie</h1>
        <p className="mt-5 max-w-2xl leading-relaxed text-ink-soft">Wyjaśniamy, co zapisujemy w przeglądarce, do czego służą te informacje i jak możesz zarządzać swoim wyborem.</p>
        <p className="mt-3 text-xs text-slate">Ostatnia aktualizacja: 20 października 2026 r.</p>

        <section className="mt-10 space-y-3" aria-labelledby="cookies-what">
          <h2 id="cookies-what" className="text-xl font-semibold">Czym są pliki cookie?</h2>
          <p className="leading-relaxed text-ink-soft">To niewielkie informacje zapisywane przez stronę w przeglądarce. Korzystamy również z pamięci localStorage i sessionStorage. Te mechanizmy nie są plikami cookie, ale także pozwalają zachować dane potrzebne podczas korzystania z serwisu.</p>
        </section>
        <section className="mt-9 space-y-3" aria-labelledby="cookies-purpose">
          <h2 id="cookies-purpose" className="text-xl font-semibold">Jak korzystamy z pamięci przeglądarki?</h2>
          <p className="leading-relaxed text-ink-soft">Sesja łączy Twoje kontakty, odpowiedzi, zadanie i rozmowę. Dzięki niej możesz wrócić do zgłoszenia w tej samej przeglądarce i uzyskać dostęp do swoich plików. W przeglądarce zapisujemy też wybór cookies oraz roboczą odpowiedź do zadania.</p>
          <p className="leading-relaxed text-ink-soft">Dodatkowe preferencje służą zapamiętaniu ustawienia dźwięku kandydata. Są wyłączone do czasu udzielenia zgody. Wybór „Tylko niezbędne” pozwala nadal korzystać z formularza, czatu i dźwięku, bez trwałego zapamiętywania tego dodatkowego ustawienia.</p>
          <p className="leading-relaxed text-ink-soft">W obecnej wersji serwisu nie korzystamy z cookies analitycznych ani reklamowych. Nie uruchamiamy Google Analytics ani reklamowych pikseli Meta. Informacje techniczne o działaniu strony mogą być rejestrowane po stronie serwera; nie jest to dodatkowa kategoria cookies w tej przeglądarce.</p>
        </section>

        <section className="mt-9" aria-labelledby="cookies-list">
          <h2 id="cookies-list" className="text-xl font-semibold">Co zapisujemy i na jak długo?</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-line-strong">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Pliki cookie i pamięć przeglądarki używane przez AlleyBiz</caption>
              <thead className="bg-surface text-ink"><tr>{["Nazwa", "Rodzaj", "Cel", "Okres"].map((title) => <th key={title} scope="col" className="px-4 py-4 font-semibold">{title}</th>)}</tr></thead>
              <tbody className="divide-y divide-line bg-paper/40 text-ink-soft">{entries.map(([name, type, purpose, duration]) => (
                <tr key={name}><th scope="row" className="px-4 py-4 align-top font-mono text-xs font-medium break-words text-ink">{name}</th><td className="px-4 py-4 align-top text-xs">{type}</td><td className="min-w-56 px-4 py-4 align-top leading-relaxed">{purpose}</td><td className="min-w-40 px-4 py-4 align-top leading-relaxed">{duration}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">Wygaśnięcie sesji lub usunięcie cookies nie usuwa automatycznie zgłoszenia i wiadomości z bazy. Może natomiast uniemożliwić ich ponowne otwarcie w tej przeglądarce.</p>
        </section>

        <section className="mt-9 space-y-3" aria-labelledby="cookies-choice">
          <h2 id="cookies-choice" className="text-xl font-semibold">Jak zmienić lub wycofać wybór?</h2>
          <p className="leading-relaxed text-ink-soft">Otwórz ustawienia poniższym przyciskiem lub linkiem „Ustawienia cookies” w stopce. Możesz pozostawić tylko niezbędne mechanizmy albo włączyć zapamiętywanie dodatkowych preferencji. Po wycofaniu zgody usuwamy zapamiętane ustawienie dźwięku kandydata. Nie usuwamy przy tym zgłoszenia ani historii rozmowy.</p>
          <p className="leading-relaxed text-ink-soft">Wybór zapisujemy na 180 dni. Możesz również usunąć cookies i pamięć witryny w ustawieniach przeglądarki. Całkowite zablokowanie cookies może utrudnić zapis formularza, dostęp do czatu i logowanie administratora.</p>
          <div className="pt-2"><CookieSettingsButton /></div>
        </section>
        <section className="mt-9 space-y-3" aria-labelledby="cookies-external">
          <h2 id="cookies-external" className="text-xl font-semibold">Linki do innych stron</h2>
          <p className="leading-relaxed text-ink-soft">Linki do App Store, Google Play, Telegrama oraz strony firmowej otwierają zewnętrzne serwisy dopiero po Twoim działaniu. Na tych stronach obowiązują zasady ich operatorów.</p>
        </section>
        <section className="mt-9 space-y-3 border-t border-line pt-7" aria-labelledby="cookies-operator">
          <h2 id="cookies-operator" className="text-xl font-semibold">Operator serwisu</h2>
          <p className="leading-relaxed text-ink-soft">Alleybizcom Sp. z o.o. · NIP 7123509615 · KRS 0001227235 · REGON 544149844.</p>
          <p className="leading-relaxed text-ink-soft">Informacje o firmie: <a href="https://alleybiz.com" target="_blank" rel="noopener noreferrer" className="text-paint underline underline-offset-4">alleybiz.com</a>.</p>
        </section>
      </main>
      <Suspense fallback={null}><CookieConsent /></Suspense>
    </SiteAccessGate>
  );
}
