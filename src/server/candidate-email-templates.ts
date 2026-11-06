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

const paragraph = (text: string) => `<p style="margin:0 0 20px;color:#33433e;font-size:16px;line-height:26px;">${escapeEmailHtml(text)}</p>`;
const note = (text: string) => `<p style="margin:0;color:#52665d;font-size:13px;line-height:21px;">${escapeEmailHtml(text)}</p>`;

function action(site: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;"><tr><td bgcolor="#087f5b" style="border-radius:12px;text-align:center;"><a href="${escapeEmailHtml(site)}" style="display:inline-block;padding:16px 24px;border:1px solid #087f5b;border-radius:12px;color:#ffffff;font-size:16px;line-height:22px;font-weight:700;text-decoration:none;">${escapeEmailHtml(label)}</a></td></tr></table>`;
}

function shell(subject: string, preheader: string, eyebrow: string, title: string, content: string) {
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeEmailHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f3;color:#12271f;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5f3"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td bgcolor="#12231d" style="padding:26px 28px;border-radius:20px 20px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">${escapeEmailHtml(brand.name)}</td><td align="right" style="padding-left:12px;color:#79e3bb;font-size:12px;line-height:18px;">Rekrutacja</td></tr></table>
</td></tr><tr><td height="4" bgcolor="#28d9a0" style="height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td bgcolor="#ffffff" style="padding:32px 28px 28px;border:1px solid #dce7e0;border-top:0;border-radius:0 0 20px 20px;">
<p style="margin:0 0 12px;color:#08734f;font-size:11px;line-height:18px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;">${escapeEmailHtml(eyebrow)}</p>
<h1 style="margin:0 0 22px;color:#12271f;font-size:28px;line-height:36px;font-weight:700;letter-spacing:-0.6px;">${escapeEmailHtml(title)}</h1>
${content}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;border-top:1px solid #e3eae6;"><tr><td style="padding-top:22px;color:#33433e;font-size:14px;line-height:22px;">Zespół <strong>${escapeEmailHtml(brand.name)}</strong></td></tr></table>
</td></tr><tr><td align="center" style="padding:22px 20px 0;color:#52665d;font-size:11px;line-height:18px;">
<p style="margin:0 0 6px;">Wiadomość dotycząca obsługi Twojego zgłoszenia.</p>
<p style="margin:0;">${escapeEmailHtml(company.name)}<br>${escapeEmailHtml(company.address)}<br>NIP ${escapeEmailHtml(company.nip)} · KRS ${escapeEmailHtml(company.krs)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

/** No recipient identity, chat contents, documents or authenticated links enter a template. */
export function buildCandidateEmailTemplate(input: EmailInput): CandidateEmailTemplate {
  const site = canonicalSite(input.site);
  const siteLabel = new URL(site).host;
  const legal = `Wiadomość dotycząca obsługi Twojego zgłoszenia.\n${company.name}\n${company.address}\nNIP ${company.nip} · KRS ${company.krs}`;
  if (input.kind === "otp") {
    if (!/^\d{6}$/.test(input.code)) throw new Error("candidate_email_invalid_code");
    const subject = `${brand.name} — Twój kod logowania`;
    const introduction = `Wpisz poniższy kod na otwartej stronie ${siteLabel}, aby potwierdzić adres e-mail i uzyskać dostęp do konta.`;
    const validity = "Kod jest ważny przez 10 minut i można go użyć tylko raz.";
    const safety = "Nie udostępniaj kodu innym osobom. Jeśli to nie Ty prosisz o kod, zignoruj tę wiadomość.";
    return {
      subject,
      text: `Twój kod logowania do ${brand.name}: ${input.code}\n\n${introduction}\n\n${validity}\n\n${safety}\n\nStrona: ${site}\n\nZespół ${brand.name}\n\n${legal}`,
      html: shell(subject, "Twój jednorazowy kod jest ważny przez 10 minut.", "Bezpieczny dostęp", "Twój kod logowania", `${paragraph(introduction)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;"><tr><td align="center" bgcolor="#edf8f2" style="padding:24px 12px;border:1px solid #b9dfcb;border-radius:14px;">
<span style="display:block;color:#0b593b;font-family:Consolas,'Courier New',monospace;font-size:36px;line-height:48px;font-weight:700;letter-spacing:6px;user-select:text;">${escapeEmailHtml(input.code)}</span>
</td></tr></table>${paragraph(validity)}${note(safety)}
<p style="margin:18px 0 0;color:#52665d;font-size:13px;line-height:21px;">Strona: <a href="${escapeEmailHtml(site)}" style="color:#08734f;text-decoration:underline;">${escapeEmailHtml(siteLabel)}</a></p>`),
    };
  }
  if (input.kind === "welcome") {
    const subject = `${brand.name} — Twoje konto jest gotowe`;
    const introduction = "Twój adres e-mail został potwierdzony. Możesz kontynuować zgłoszenie i wracać do niego również na innym urządzeniu.";
    const instructions = "Aby wrócić, otwórz stronę, wybierz „Moje zgłoszenie” i wpisz ten sam adres e-mail. Na nowym urządzeniu potwierdź wejście jednorazowym kodem otrzymanym pocztą. W zapisanej sesji zgłoszenie otworzy się automatycznie.";
    const reassurance = "Nie potrzebujesz hasła. Zachowaj tę wiadomość, aby mieć pod ręką aktualny adres strony.";
    return {
      subject,
      text: `Witaj w ${brand.name}!\n\n${introduction}\n\nOtwórz moje zgłoszenie:\n${site}\n\n${instructions}\n\n${reassurance}\n\nZespół ${brand.name}\n\n${legal}`,
      html: shell(subject, "Twój adres e-mail jest potwierdzony. Tutaj znajdziesz dostęp do zgłoszenia.", "Moje zgłoszenie", `Witaj w ${brand.name}!`, `${paragraph(introduction)}${action(site, "Otwórz moje zgłoszenie")}
<p style="margin:0 0 8px;color:#12271f;font-size:15px;line-height:24px;font-weight:700;">Jak wrócić do swojego zgłoszenia?</p>${paragraph(instructions)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f7f5" style="border-radius:12px;"><tr><td style="padding:16px 18px;">${note(reassurance)}<p style="margin:10px 0 0;font-size:14px;line-height:22px;"><a href="${escapeEmailHtml(site)}" style="color:#08734f;font-weight:700;text-decoration:underline;">${escapeEmailHtml(siteLabel)}</a></p></td></tr></table>`),
    };
  }
  const subject = `${brand.name} — nowa wiadomość od HR`;
  const introduction = "W Twoim zgłoszeniu czeka nieprzeczytana wiadomość od zespołu HR. Otwórz czat, aby ją przeczytać i w razie potrzeby odpowiedzieć.";
  const instructions = "Jeśli pojawi się ekran logowania, wybierz „Moje zgłoszenie” i wpisz ten sam adres e-mail. Dostęp potwierdzisz jednorazowym kodem.";
  const privacy = "Ze względu na prywatność nie dołączamy treści rozmowy ani dokumentów do e-maili.";
  const grouping = "Kilka wiadomości łączymy w jedno powiadomienie. Kolejne wysyłamy nie częściej niż raz na 3 godziny, tylko gdy pojawią się nowe nieprzeczytane wiadomości.";
  return {
    subject,
    text: `Nowa wiadomość od HR\n\n${introduction}\n\nPrzejdź do rozmowy:\n${site}\n\n${instructions}\n\n${privacy}\n\n${grouping}\n\nZespół ${brand.name}\n\n${legal}`,
    html: shell(subject, "Otwórz swoje zgłoszenie, aby przeczytać wiadomość od zespołu HR.", "Czat z HR", "Masz nową wiadomość", `${paragraph(introduction)}${action(site, "Przejdź do rozmowy")}${paragraph(instructions)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f7f5" style="border-radius:12px;"><tr><td style="padding:16px 18px;">${note(privacy)}</td></tr></table>
<p style="margin:20px 0 0;color:#52665d;font-size:12px;line-height:20px;">${escapeEmailHtml(grouping)}</p>
<p style="margin:12px 0 0;font-size:13px;line-height:21px;"><a href="${escapeEmailHtml(site)}" style="color:#08734f;text-decoration:underline;">${escapeEmailHtml(siteLabel)}</a></p>`),
  };
}
