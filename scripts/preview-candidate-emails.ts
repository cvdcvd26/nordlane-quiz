/** Local-only samples. Does not load env files, query a database or send mail. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCandidateEmailTemplate, escapeEmailHtml } from "../src/server/candidate-email-templates";

async function main() {
const directory = path.resolve(process.argv[2] ?? "../../output/email-previews");
const site = "https://itsolution.fun";
const previews = [
  { filename: "01-login-code", label: "01 · Kod logowania", detail: "Jednorazowy kod · 10 minut", template: buildCandidateEmailTemplate({ kind: "otp", site, code: "123456" }) },
  { filename: "02-welcome", label: "02 · Powitanie", detail: "Pierwsze potwierdzenie adresu e-mail", template: buildCandidateEmailTemplate({ kind: "welcome", site }) },
  { filename: "03-unread-message", label: "03 · Wiadomość od HR", detail: "Powiadomienie o nieprzeczytanej wiadomości w czacie", template: buildCandidateEmailTemplate({ kind: "chat", site }) },
];
await mkdir(directory, { recursive: true });
for (const { filename, template } of previews) {
  await writeFile(path.join(directory, `${filename}.html`), template.html);
  await writeFile(path.join(directory, `${filename}.txt`), `Temat: ${template.subject}\n\n${template.text}\n`);
}
await writeFile(path.join(directory, "index.html"), `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IT Solution · Podgląd wiadomości</title><style>
*{box-sizing:border-box}body{margin:0;background:#e9efec;color:#12271f;font:16px/1.6 Arial,Helvetica,sans-serif}header{padding:40px 32px;background:#12231d;color:white;border-bottom:4px solid #28d9a0}header div,main{max-width:1440px;margin:auto}h1{font-size:32px;line-height:1.2;margin:8px 0 12px}header p{margin:0;color:#c5d8cf}.kicker{color:#79e3bb;font-size:12px;letter-spacing:2px;font-weight:bold}main{padding:30px 24px}section{margin-bottom:32px;background:white;border:1px solid #dce7e0;border-radius:18px;overflow:hidden}.meta{padding:22px 24px;border-bottom:1px solid #e3eae6}h2{margin:0 0 4px;font-size:21px}.detail{margin:0 0 12px;color:#52665d;font-size:14px}a{color:#08734f;font-weight:700;margin-right:18px}.frames{display:grid;grid-template-columns:minmax(0,1fr) 375px;gap:20px;padding:22px;background:#f1f5f3}.frame-label{font-size:11px;color:#52665d;letter-spacing:1px;font-weight:bold;margin:0 0 8px}iframe{width:100%;height:1280px;display:block;border:1px solid #dce7e0;background:white;border-radius:12px}@media(max-width:900px){.frames{grid-template-columns:1fr}.mobile{max-width:375px}header{padding:30px 24px}main{padding:20px 12px}.frames{padding:12px}}@media(max-width:440px){.mobile{display:none}iframe{height:1320px}.meta{padding:18px}}
</style></head><body><header><div><span class="kicker">IT SOLUTION · E-MAIL</span><h1>Jedna identyfikacja. Trzy wiadomości.</h1><p>Podgląd lokalny · dane przykładowe · żaden e-mail nie został wysłany.</p></div></header><main>${previews.map(({ filename, label, detail, template }) => `<section><div class="meta"><h2>${escapeEmailHtml(label)}</h2><p class="detail">${escapeEmailHtml(detail)}<br>Temat: ${escapeEmailHtml(template.subject)}</p><a href="${filename}.html">Otwórz HTML</a><a href="${filename}.txt">Wersja tekstowa</a></div><div class="frames"><div><p class="frame-label">DESKTOP</p><iframe src="${filename}.html" title="${escapeEmailHtml(label)} — desktop"></iframe></div><div class="mobile"><p class="frame-label">MOBILE · 375 PX</p><iframe src="${filename}.html" title="${escapeEmailHtml(label)} — mobile"></iframe></div></div></section>`).join("")}</main></body></html>`);
console.log(`Created ${previews.length} local email previews: ${directory}`);
}

main().catch(() => { console.error("Could not create local email previews."); process.exitCode = 1; });
