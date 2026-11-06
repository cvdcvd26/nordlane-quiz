# Candidate email: activation and delivery checks

The integration is disabled by default. No real emails are sent until the owner
configures Brevo and explicitly enables `CANDIDATE_EMAIL_ENABLED=true`.
Existing anonymous applications remain accessible through their existing cookies.

## Owner setup

1. Create the owner's free Brevo account and confirm the account email.
2. In Brevo, add the sender domain (for example, `itsolution.fun`). Copy **the DNS
   records shown by that account** into its DNS provider. Do not replace unrelated
   website, MX or existing mail records. Wait until Brevo confirms authentication.
3. Configure a sender address on the verified domain, such as
   `powiadomienia@itsolution.fun`. A Brevo sender is not a mailbox for replies.
4. Create a dedicated server-side Brevo API key and save it as a secret environment
   variable. Do not paste keys in chat, commit them, or expose them in `NEXT_PUBLIC_*`.
5. Configure `APP_URL` as the exact public HTTPS origin of this application, e.g.
   `https://itsolution.fun`. This is the destination in emails; it is independent
   of the sender domain. Follow `docs/domain-migration.md` when switching origins.
6. Set `BREVO_SENDER_EMAIL`, `BREVO_API_KEY`, and a new random
   `CANDIDATE_EMAIL_SECRET` of at least 32 characters. Keep the feature disabled
   until database migrations, queue deployment and test delivery are verified.

Do not enable email on arbitrary preview deployments against the production
database. Use a separate database and sender/test recipients for previews.

## Expected behaviour

- One-time login code: six digits, expires after ten minutes; five verification
  attempts. Resending is rate limited. A confirmed address restores its existing
  application on another device. Existing applications are never matched by phone.
- A welcome email is queued once after first verification. It gives the public
  website address and explains returning through “Moje zgłoszenie” with the same
  email and a new code. Repeat logins send only the code.
- New HR messages create a durable notification group in the same database
  transaction as the message. The first email waits 30 minutes from the oldest
  eligible unread message. Further messages do not postpone that timer forever.
- Later chat notifications are separated by at least three hours, and require
  **new** unread messages. The same old messages are not repeatedly emailed.
- Read receipts are recorded only after the open conversation's end is actually
  visible in a visible browser tab. Polling and general site activity do not count.
- Transactional chat notifications are part of the application, disclosed before
  requesting the login code. There is no per-candidate opt-out switch. This does
  not subscribe candidates to advertising or other marketing mail.
- Automatic acknowledgements, edits and private administrator status changes do
  not create chat emails. Deleted messages and published results that close the
  chat are checked again before sending.
- Emails contain self-contained HTML and a complete plain-text fallback with a
  website link, never chat text, attachments or recruitment documents. Brevo
  receives the recipient address and technical email.
- Notifications use a separate durable Vercel Queue topic (QStash on non-Vercel
  hosts). The daily maintenance sweep is recovery only, not the primary timer.

## Before enabling for candidates

- Test a fresh email registration, welcome delivery, logout and login from a second
  browser/device. Confirm that the same lead, answers, files and chat are restored.
- Test a legacy application linking an email without losing its existing data.
- Confirm a second account cannot access the first account's chat or attachments.
- Send a sequence of test HR messages, leave them unread, and verify one notification
  after 30 minutes. Repeat with reading before the deadline and confirm no email.
- Verify the three-hour cooldown and a new subsequent group; do not infer success
  from an API acceptance response alone. Check Brevo's delivery logs and mailbox.
- Inspect the received raw email/MIME for content, links and unexpected tracking.
- Check quota errors, provider errors, retries and queue callback protection. Review
  pending/failed/uncertain jobs before expanding delivery; don't automatically resend
  a send with an ambiguous provider result outside its deduplication window.

Brevo Free's quota includes codes, welcome emails and notifications together.
Hitting the cap can delay mail; grouping does not make the daily quota unlimited.
No paid subscription or automatic upgrade is created by this integration.
