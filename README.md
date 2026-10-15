# Nordlane Studio — quiz, task and chat

> **Portfolio demo.** The brand is fictional; all copy is placeholder. UI language: Polish.

A four-step flow: contact details (name, Polish phone number with a +48 mask, optional Telegram), then three yes/no questions, then the company info and a task (PDF brief + screenshot upload), a delayed automatic message, a built-in chat and an admin panel with leads, deletion and sound notifications.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · PostgreSQL (Neon) + Drizzle ORM · Vercel Blob (private store) · Upstash QStash (delayed jobs) · Vercel.

---

## How it works

```
Kontakt ──► Pytania (3× "Tak / Nie") ──► Step 2: task + PDF + screenshots ──► "Zadanie wysłane" + chat
                                     │
              POST /api/submit (one transaction):
              submission, files, conversation, scheduled_messages row
                                     │
              QStash: deliver after a random 20–30 min
                                     ▼
              POST /api/jobs/deliver ──► system message in the chat
                                     │
              Contact saved (step 1) ──► exactly one lead ──► /admin
```

**Reliable delayed message**

- The send time is chosen by the server at submission and stored in the database. No client-side `setTimeout`.
- QStash calls `/api/jobs/deliver` (signature verified). Errors return 5xx and QStash retries up to 5 times with backoff.
- Duplicates are prevented twice: the row is atomically claimed (`pending → sending`), and the system message has a deterministic `client_message_id` under a unique index.
- If QStash is unavailable at submission, the job stays `pending` in the database and a backup path delivers it: the daily Vercel Cron `/api/jobs/sweep`, or the visitor's next chat request.
- Status, attempts, last error and actual send time are stored and shown on the lead page.

**Contacts.** Name and phone are required, Telegram is optional. The phone field formats as you type or paste (`+48 600 123 456`) and is stored as E.164 (`+48600123456`); Telegram is stored as `@username` or `null`. The same rules run in the browser and on the server.

**Leads.** A lead is created as soon as the visitor saves contact details on the first screen. A unique index on `leads.session_id` guarantees one lead per session; answers, the task and every message belong to it. The list shows the funnel stage (Kontakt → Pytania → Zadanie wysłane). The admin can write before the task is sent; the visitor sees it once the chat opens.

**Deleting leads.** From the lead page (“Usuń lead”) or several at once from the list (checkboxes → “Usuń zaznaczone”), with an inline confirmation. Deletion removes the visitor session, which cascades to contact, answers, submission, conversation, messages, notes and file rows; stored files are deleted from Blob as well.

**Review.** On the task step the worker also writes a review (required, 10–3000 characters; the draft survives a reload). It is saved with the submission (`task_submissions.review`, migration `0002_review.sql`), shown in its own “Opinia / Отзыв / Review” block on the lead page and included in the admin search.

**Admin design.** The admin uses its own light, restrained theme (warm-gray background, white panels, 1px borders, 6–8px radii, one accent: the brand blue darkened to `#0f6fd6` for contrast; semantic colours only for statuses and feedback). Tokens are the `--color-adm-*` variables and `.adm-*` classes in `globals.css`; icons come from `lucide-react`. Layout: sidebar (Leads, Reviews, Settings), compact tables, toasts for success/error. The visitor site keeps its navy theme.

**Lead workflow.** The lead page shows the four visitor screens (Kontakt → Pytania → Zadanie → Gotowe) with the current one highlighted — this updates automatically. The handling status is separate: change it from the lead page (buttons + “move to next status”) or straight from the leads table.

**Reviews page.** `/admin/reviews` lists every review with the employee, date, lead status and a link to the lead (no rating — the form does not collect one).

**Admin languages.** The admin panel is available in Polish, Russian and English (PL / RU / EN switch in the header and on the login page). The first visit picks the browser language; the choice is remembered per browser. Copy lives in `src/config/admin-i18n.ts` (Polish comes from `content.ts`; TypeScript checks that every language has the same keys). Server error messages are translated in the panel. The visitor site stays Polish.

**Sound notifications.** A short Web Audio chime (no audio files). The visitor hears it when an admin or automatic message arrives; the admin panel polls `/api/admin/activity` every 5 s and plays a chime plus a toast for new leads and new visitor messages on any admin page, and refreshes the open list/lead. Both sides have a speaker button to mute; the choice is remembered per browser. Browsers allow sound only after the first click on the page.

**Security**

- Visitor session: a random 256-bit token in an httpOnly cookie; the database stores only its SHA-256. Client-supplied IDs are never trusted.
- Admin: bcrypt, JWT in an httpOnly `SameSite=Strict` cookie, `token_version` (changing the password ends all sessions), login rate limiting, `Origin` check on all state-changing requests, server-side checks in every `/api/admin/*` handler.
- Files: size, count, declared MIME **and the real file bytes** are validated; safe storage keys; private Blob store; served only through `/api/files/[id]` with an ownership check (foreign file → 404).
- Internal notes live in a separate table and never reach visitor APIs.
- Rate limiting in Postgres (works across serverless instances).

---

## Project structure

```
src/
  config/content.ts      all UI copy (Polish) — the only place to change texts
  config/settings.ts     upload limits, chat settings, defaults
  db/schema.ts           database schema (Drizzle)
  lib/contact.ts         phone mask (+48), phone/Telegram validation — shared by browser and server
  server/services/       business logic: quiz, uploads, submission, delivery, chat, admin
  server/*.ts            sessions, auth, storage, queue, rate limiting
  app/api/**             thin API routes
  app/page.tsx           visitor flow
  app/admin/**           admin panel
  components/            UI
drizzle/                 SQL migrations
scripts/                 migrate, create-admin
tests/                   critical-path tests (real Postgres via PGlite)
public/task-brief.pdf    task PDF (placeholder)
```

Tables: `admin_users`, `visitor_sessions`, `visitor_contacts`, `quiz_answers`, `task_submissions`, `files`, `leads`, `conversations`, `messages`, `scheduled_messages`, `lead_notes`, `app_settings`, `rate_limits`.

---

## Deploying to Vercel

1. **GitHub:** create a repository and upload the project contents (`src`, `drizzle`, `public`, `scripts`, `tests` and the root files).
2. **Vercel → Add New → Project → Import** the repository. Default settings (Framework: Next.js). The first deploy builds even without a database.
3. **Database:** Project → Storage → Create Database → **Neon** → Connect. This adds `DATABASE_URL`. Migrations run automatically on every deploy (`vercel-build`).
4. **Files:** Project → Storage → Create → **Blob**, choose **Private** → Connect. This adds `BLOB_READ_WRITE_TOKEN`.
5. **Delayed jobs:** Integrations → **Upstash QStash** → connect to the project (or copy the keys from console.upstash.com/qstash): `QSTASH_TOKEN`, `QSTASH_URL`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`.
6. **Settings → Environment Variables**, add:
   - `ADMIN_SESSION_SECRET` — random string, 32+ characters;
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` — the first administrator;
   - `CRON_SECRET` — any long random string.
7. **Redeploy** (Deployments → ⋯ → Redeploy).

### First administrator

Open `/admin` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`: the admin is created on the first login with a hashed password. Then **remove `ADMIN_PASSWORD`** from the environment and change the password in `/admin/settings`.

From a terminal: `DATABASE_URL=... npm run admin:create -- admin@example.com 'long-password'` (also resets an existing admin's password).

---

## Running locally

```bash
npm install
cp .env.example .env.local      # fill in DATABASE_URL and ADMIN_SESSION_SECRET
npm run db:migrate
npm run admin:create -- admin@example.com 'long-password'
npm run dev                     # http://localhost:3000, admin at /admin
```

Local PostgreSQL, e.g. with Docker:

```bash
docker run -d --name nordlane-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
# DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

- A `localhost` URL uses the regular `pg` driver; anything else uses the Neon driver.
- Without `BLOB_READ_WRITE_TOKEN` in development, files are stored in `./.data` (local only; on Vercel the token is required).
- Without `QSTASH_TOKEN` in development, the automatic message is delivered by the backup path while the visitor has the chat open. To test real QStash locally, run `npx @upstash/qstash-cli dev`, use its `QSTASH_URL` / `QSTASH_TOKEN` / signing keys and set `APP_URL=http://localhost:3000`.

### Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

`npm test` runs the critical scenarios against a real Postgres (PGlite): contact validation and normalisation (E.164 phone, `@telegram`), saving all three answers, accepting and rejecting files, idempotent submission, the 20–30 minute delay, no duplicates on repeated delivery, a single lead per visitor, admin replies, hidden internal notes and no access to other visitors' data.

---

## Changing the copy

- All texts, the three questions, answer options, contact form labels, instructions, errors and statuses: `src/config/content.ts`.
- PDF: replace `public/task-brief.pdf` or point `content.task.pdf.url` elsewhere.
- Automatic message text, delay, on/off and chat attachments: `/admin/settings` (stored in the database).
- Upload limits: `src/config/settings.ts` or `NEXT_PUBLIC_MAX_FILE_MB`, `NEXT_PUBLIC_MAX_FILES`. Max file size is 4 MB because Vercel functions accept request bodies up to 4.5 MB.
