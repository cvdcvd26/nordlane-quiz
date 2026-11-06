import "server-only";
import { brand, company } from "@/config/brand";

export type CandidateEmailTemplate = { subject: string; text: string; html: string };
type EmailInput = { kind: "otp"; site: string; code: string } | { kind: "welcome" | "chat"; site: string };

/** Escape every value inserted into HTML, including our own configurable copy. */
export function escapeEmailHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Email links may only use the canonical origin supplied by candidateSiteUrl(). */
function canonicalSite(value: string) {
  const url = new URL(value);
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value) || url.protocol !== "https:" ||
      url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("candidate_email_invalid_site");
  }
  return url.origin;
}

const paragraph = (text: string) => `<p style="margin:0 0 22px;color:#42554c;font-size:16px;line-height:26px;">${escapeEmailHtml(text)}</p>`;
const note = (text: string) => `<p style="margin:0;color:#52665d;font-size:13px;line-height:21px;">${escapeEmailHtml(text)}</p>`;

function action(site: string, label: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 30px;"><tr><td bgcolor="#28dba2" style="border-radius:14px;text-align:center;"><a href="${escapeEmailHtml(site)}" style="display:block;padding:18px 16px;border:1px solid #28dba2;border-radius:14px;color:#082c20;font-size:16px;line-height:24px;font-weight:700;text-decoration:none;">${escapeEmailHtml(label)} <span aria-hidden="true" style="padding-left:12px;">&#8599;</span></a></td></tr></table>`;
}

function step(number: string, title: string, text: string, last = false) {
  return `<tr><td width="34" valign="top" style="width:34px;padding:16px 10px 16px 0;${last ? "" : "border-bottom:1px solid #dce8e1;"}color:#08734f;font-family:Consolas,'Courier New',monospace;font-size:14px;line-height:22px;font-weight:700;">${escapeEmailHtml(number)}</td><td valign="top" style="padding:16px 0;${last ? "" : "border-bottom:1px solid #dce8e1;"}"><p style="margin:0 0 4px;color:#142b21;font-size:14px;line-height:22px;font-weight:700;">${escapeEmailHtml(title)}</p>${note(text)}</td></tr>`;
}

function callout(title: string, text: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f7f3" style="border-radius:12px;"><tr><td width="4" bgcolor="#28dba2" style="width:4px;border-radius:12px 0 0 12px;"></td><td style="padding:18px 18px;"><p style="margin:0 0 5px;color:#193b2b;font-size:14px;line-height:22px;font-weight:700;">${escapeEmailHtml(title)}</p>${note(text)}</td></tr></table>`;
}

function shell(subject: string, preheader: string, eyebrow: string, title: string, accent: string, content: string) {
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeEmailHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#eaf0ec;color:#12271f;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eaf0ec"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td bgcolor="#101f19" style="padding:26px 24px 30px;border-radius:24px 24px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="color:#ffffff;font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.6px;">${escapeEmailHtml(brand.name)}<span style="color:#28dba2;">.</span></td><td align="right" style="padding-left:10px;color:#b2c6bb;font-size:9px;line-height:16px;letter-spacing:1.1px;text-transform:uppercase;">Rekrutacja</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;border-top:1px solid #33483c;"><tr><td style="padding-top:24px;"><p style="margin:0 0 13px;color:#93e7c3;font-size:10px;line-height:18px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;">${escapeEmailHtml(eyebrow)}</p>
<h1 style="margin:0;color:#ffffff;font-size:36px;line-height:41px;font-weight:700;letter-spacing:-1.1px;">${escapeEmailHtml(title)}<br><span style="color:#28dba2;">${escapeEmailHtml(accent)}</span></h1>
</td></tr></table></td></tr>
<tr><td bgcolor="#ffffff" style="padding:28px 24px 24px;border:1px solid #dce7e0;border-top:0;border-radius:0 0 24px 24px;">
${content}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;border-top:1px solid #e3eae6;"><tr><td style="padding-top:20px;color:#42554c;font-size:13px;line-height:22px;">Do zobaczenia,<br><strong style="color:#12271f;">Zespół ${escapeEmailHtml(brand.name)}</strong></td><td align="right" valign="bottom" style="padding-top:20px;color:#08734f;font-family:Consolas,'Courier New',monospace;font-size:15px;line-height:22px;">// IT</td></tr></table>
</td></tr><tr><td align="center" style="padding:20px 12px 0;color:#52665d;font-size:11px;line-height:18px;">
<p style="margin:0 0 5px;">Wiadomość dotycząca Twojego zgłoszenia.</p>
<p style="margin:0;">${escapeEmailHtml(company.name)}<br>${escapeEmailHtml(company.address)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

/** No recipient identity, chat contents, documents or authenticated links enter a template. */
export function buildCandidateEmailTemplate(input: EmailInput): CandidateEmailTemplate {
  const site = canonicalSite(input.site);
  const legal = `Wiadomość dotycząca obsługi Twojego zgłoszenia.\n${company.name}\n${company.address}\nNIP ${company.nip} · KRS ${company.krs}`;
  if (input.kind === "otp") {
    if (!/^\d{6}$/.test(input.code)) throw new Error("candidate_email_invalid_code");
    const subject = `${brand.name} — Twój kod logowania`;
    const introduction = "Wpisz poniższy kod w otwartym formularzu, aby potwierdzić adres e-mail i uzyskać dostęp do swojego zgłoszenia.";
    const validity = "Kod jest ważny przez 10 minut i można go użyć tylko raz.";
    const safety = "Nie udostępniaj kodu innym osobom. Jeśli to nie Ty prosisz o kod, zignoruj tę wiadomość.";
    return {
      subject,
      text: `Twój kod logowania do ${brand.name}: ${input.code}\n\n${introduction}\n\n${validity}\n\n${safety}\n\nStrona: ${site}\n\nZespół ${brand.name}\n\n${legal}`,
      html: shell(subject, "Wpisz jednorazowy kod w formularzu. Kod jest ważny przez 10 minut.", "Bezpieczny dostęp", "Potwierdź", "swój e-mail.", `${paragraph(introduction)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 22px;"><tr><td align="center" bgcolor="#28dba2" style="padding:22px 10px;border-radius:16px;">
<p style="margin:0 0 8px;color:#123b2a;font-size:10px;line-height:18px;letter-spacing:1.3px;font-weight:700;">TWÓJ JEDNORAZOWY KOD</p>
<span style="display:block;color:#082c20;font-family:Consolas,'Courier New',monospace;font-size:40px;line-height:52px;font-weight:700;letter-spacing:4px;user-select:text;">${escapeEmailHtml(input.code)}</span>
<p style="margin:8px 0 0;color:#123b2a;font-size:12px;line-height:20px;">10 minut ważności &nbsp;·&nbsp; Jedno użycie</p>
</td></tr></table>${callout("Kod pozostaje tylko dla Ciebie", safety)}`),
    };
  }
  if (input.kind === "welcome") {
    const subject = `${brand.name} — Twoje konto jest gotowe`;
    const introduction = "Twój adres e-mail został potwierdzony. Możesz kontynuować zgłoszenie i wracać do niego również na innym urządzeniu.";
    const instructions = "Aby wrócić, otwórz stronę, wybierz „Moje zgłoszenie” i wpisz ten sam adres e-mail. Na nowym urządzeniu potwierdź wejście jednorazowym kodem otrzymanym pocztą. W zapisanej sesji zgłoszenie otworzy się automatycznie.";
    const reassurance = "Nie potrzebujesz hasła. Zachowaj tę wiadomość — przycisk zawsze prowadzi do serwisu.";
    return {
      subject,
      text: `Witaj w ${brand.name}!\n\n${introduction}\n\nPrzejdź do serwisu:\n${site}\n\n${instructions}\n\n${reassurance}\n\nZespół ${brand.name}\n\n${legal}`,
      html: shell(subject, "Twój adres e-mail jest potwierdzony. Możesz kontynuować swoje zgłoszenie.", "Twoje konto jest gotowe", "Witaj w", `${brand.name}.`, `${paragraph(introduction)}${action(site, "Przejdź do serwisu")}
<p style="margin:0 0 2px;color:#142b21;font-size:16px;line-height:24px;font-weight:700;">Wracasz do zgłoszenia?</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">${step("01", "Wybierz „Moje zgłoszenie”", "Otwórz serwis i wpisz ten sam adres e-mail.")}${step("02", "Potwierdź wejście kodem", "Na nowym urządzeniu otrzymasz jednorazowy kod. W zapisanej sesji zgłoszenie otworzy się automatycznie.", true)}</table>
${callout("Bez hasła. Zawsze pod ręką.", reassurance)}`),
    };
  }
  const subject = `${brand.name} — nowa wiadomość od HR`;
  const introduction = "W Twoim zgłoszeniu czeka nieprzeczytana wiadomość od zespołu HR. Otwórz czat, aby ją przeczytać i w razie potrzeby odpowiedzieć.";
  const instructions = "Jeśli pojawi się ekran logowania, wybierz „Moje zgłoszenie” i wpisz ten sam adres e-mail. Dostęp potwierdzisz jednorazowym kodem.";
  const privacy = "Ze względu na prywatność nie dołączamy treści rozmowy ani dokumentów do e-maili.";
  return {
    subject,
    text: `Nowa wiadomość od HR\n\n${introduction}\n\nOtwórz czat z HR:\n${site}\n\n${instructions}\n\n${privacy}\n\nZespół ${brand.name}\n\n${legal}`,
    html: shell(subject, "Zespół HR napisał do Ciebie. Otwórz zgłoszenie, aby przeczytać wiadomość.", "Wiadomość od zespołu HR", "Masz nową", "wiadomość.", `${paragraph(introduction)}${action(site, "Otwórz czat z HR")}
${callout("Wracasz z innego urządzenia?", instructions)}
<p style="margin:22px 0 0;color:#52665d;font-size:13px;line-height:21px;">${escapeEmailHtml(privacy)}</p>`),
  };
}
