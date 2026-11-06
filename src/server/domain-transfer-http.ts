import "server-only";
import { randomBytes } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import { AppError } from "./errors";
import { siteDomains } from "@/config/site-domains";

export const transferHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

export const transferRedirect = (location: string) => new Response(null, {
  status: 303, headers: { ...transferHeaders, Location: location },
});

/** No framework layout, analytics, external fonts or third-party JavaScript. */
export function transferPage(completing: boolean, status = 200) {
  const nonce = randomBytes(24).toString("base64url");
  const script = completing ? `
const fragment = new URLSearchParams(location.hash.slice(1));
const input = {state: fragment.get('state'), code: fragment.get('code')};
history.replaceState(null, '', '/session-transfer/complete');
fetch('/api/session-transfer/complete', {
  method: 'POST', credentials: 'same-origin', cache: 'no-store',
  headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)
}).then(async response => {
  if (!response.ok) throw new Error('transfer');
  const result = await response.json();
  if (typeof result.destination !== 'string' || !result.destination.startsWith('/') || result.destination.startsWith('//') || result.destination.includes('\\\\')) throw new Error('destination');
  location.replace(result.destination);
}).catch(() => {
  document.getElementById('progress').hidden = true;
  document.getElementById('heading').textContent = 'Nie udało się przywrócić sesji';
  document.getElementById('description').textContent = 'Twoje wcześniejsze zgłoszenie pozostaje zapisane. Spróbuj ponownie. Możesz też przejść dalej bez przywracania sesji.';
  document.getElementById('actions').hidden = false;
});` : "";
  return new Response(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IT Solution</title><style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:#080e0c;color:#e9f3ee;font:16px/1.6 system-ui,sans-serif;min-height:100svh;display:grid;place-items:center;padding:24px}main{width:min(100%,480px);padding:36px;border:1px solid #214637;border-radius:24px;background:#0e1914}small{color:#20dfa2;font-weight:700;letter-spacing:.12em}h1{font-size:26px;line-height:1.25}p{color:#9aada4}#progress{height:4px;background:#173a2a;overflow:hidden;border-radius:4px}#progress:after{content:'';display:block;width:40%;height:100%;background:#20dfa2;animation:load 1.2s ease-in-out infinite}@keyframes load{from{transform:translateX(-100%)}to{transform:translateX(350%)}}@media(prefers-reduced-motion:reduce){#progress:after{animation:none;width:100%}}a{color:#51e9b7;display:block;margin-top:14px} [hidden]{display:none!important}
</style></head><body><main><small>IT SOLUTION</small><h1 id="heading">${completing ? "Przywracamy Twoją sesję" : "Nie udało się przywrócić sesji"}</h1><p id="description">${completing ? "Za chwilę otworzymy Twoje zgłoszenie pod nowym adresem." : "Twoje wcześniejsze zgłoszenie pozostaje zapisane. Spróbuj ponownie. Możesz też przejść dalej bez przywracania sesji."}</p><div id="progress" role="progressbar" aria-label="Przywracanie sesji"${completing ? "" : " hidden"}></div><div id="actions"${completing ? " hidden" : ""}><a href="${siteDomains.canonical}/session-transfer/start">Spróbuj ponownie</a><a href="${siteDomains.canonical}/session-transfer/skip">Kontynuuj bez przywracania sesji</a></div><noscript><p>Włącz JavaScript, aby przywrócić sesję.</p></noscript></main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`, {
    status, headers: { ...transferHeaders, "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` },
  });
}

/** Deliberately do not log exception payloads: they may include SQL credentials. */
export function transferRoute(fn: (request: Request) => Promise<Response>, api = false) {
  return async (request: Request) => {
    try { return await fn(request); }
    catch (error) {
      unstable_rethrow(error);
      const status = error instanceof AppError ? error.status : 503;
      if (api) return Response.json({ error: "Nie udało się przywrócić sesji.", code: "transfer_unavailable" }, { status, headers: transferHeaders });
      return transferPage(false, status);
    }
  };
}
