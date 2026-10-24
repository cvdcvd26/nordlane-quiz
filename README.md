# AlleyBiz Quiz — quiz, task and chat

> AlleyBiz Quiz landing and recruitment task. UI language: Polish.

A four-step flow: contact details (name, Polish phone number with a +48 mask, optional Telegram), then three yes/no questions, then the company info and a task (PDF brief + screenshot upload), a delayed automatic message, a built-in chat and an admin panel with leads, deletion and sound notifications.

**Runtime:** Node.js 22.12 or newer (24 LTS recommended).

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · PostgreSQL (Neon) + Drizzle ORM · Vercel Blob (private store) · Upstash QStash (delayed jobs) · Vercel.

---

## How it works

```
Kontakt ──► Pytania (3× "Tak / Nie") ──► Step 2: task + PDF + screenshots ──► "Zadanie wysłane" + chat
                                     │
              POST /api/submit (one transaction):
              submission, files, conversation, scheduled_messages row
                                     │
              QStash: deliver after a random 30–60 sec
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

**Conversation workspace.** Lead pages include a searchable, paginated conversation list next to the chat and candidate details. On narrow screens the list opens in a drawer. Queue, stage, inactivity, status and sorting context are retained in candidate links. Registered unsaved lead/reminder/revision forms warn before internal link navigation, logout or a page unload; browser history navigation is not intercepted.

**Unfinished applications.** The leads page has a separate queue for candidates who saved contact details but have not submitted the initial task, excluding completed/rejected leads. Its default inactivity threshold is 30 minutes; stage and inactivity filters are adjustable. The badge always counts all stages at that default threshold. Recent activity means a visible session heartbeat within two minutes; it is not a guarantee of continuous online presence.

**Reminders.** Shared lead follow-up tasks support creation, editing, completion, reopening, deletion and optimistic conflict checks. `/admin/reminders` lists due, upcoming and completed tasks. Dates use Poland's calendar and handle daylight saving transitions. In-panel alerts work while an administrator has the panel open; no email, SMS or browser push service is connected.

**Task corrections.** After the initial submission, an administrator may request one pending correction round with instructions. Candidates respond with corrected text/screenshots above their existing chat. The original submission and previous rounds remain available. Publishing a refusal cancels any pending correction; terminal draft files become inaccessible and storage cleanup retries through the existing sweep.

**Funnel and sources.** `/admin/analytics` reports cohorts of currently stored browser sessions by their creation date, with contact, answer, recorded task-view and initial-submission counts. Calendar ranges use Europe/Warsaw. Historical task views are unknown rather than fabricated, and deleting a session also removes it from these reports. UTM labels and referrer host are stored only after the current optional-cookie consent; withdrawal clears those fields. Version 1 sound-only consent does not authorize attribution, so version 2 requests a fresh choice. No external trackers or advertising click IDs are used.

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
public/Rejestracja_Ryanair_Instrukcja.pdf    supplied task instructions
```

Tables: `admin_users`, `visitor_sessions`, `visitor_contacts`, `quiz_answers`, `task_submissions`, `files`, `leads`, `conversations`, `messages`, `scheduled_messages`, `lead_notes`, `testimonials`, `managers`, `app_settings`, `rate_limits`.

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

The main administrator can replace their sign-in email and password together in **Settings → Main administrator access**, after entering the current password. This updates the same account, preserves its permissions and data, rotates the current session, and invalidates all previously issued session tokens. Additional administrators only see their own password-change form; the replacement API also rejects their requests. The email is a login identifier and does not require an email delivery service.

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

CLI scripts load `.env.local` / `.env` automatically.

Local PostgreSQL, e.g. with Docker:

```bash
docker run -d --name nordlane-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
# DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

- `*.neon.tech` uses Neon over WebSocket. Other PostgreSQL hosts (including Render, VPS, localhost and IPv6) use `pg` over TCP. `DATABASE_DRIVER=postgres|neon` overrides detection.
- Without `BLOB_READ_WRITE_TOKEN` in development, files are stored in `./.data` (local only; on Vercel the token is required).
- Without `QSTASH_TOKEN` in development, the automatic message is delivered by the backup path while the visitor has the chat open. To test real QStash locally, run `npx @upstash/qstash-cli dev`, use its `QSTASH_URL` / `QSTASH_TOKEN` / signing keys and set `APP_URL=http://localhost:3000`.

### Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

`npm test` runs the critical scenarios against PostgreSQL-compatible PGlite: contact validation and normalisation (E.164 phone, `@telegram`), saving all three answers, accepting and rejecting files, idempotent submission, the 30–60 second delay, no duplicates on repeated delivery, a single lead per visitor, admin replies, hidden internal notes and no access to other visitors' data.

---

## Owner-only document generator

The last admin navigation item opens `/admin/documents`. Only the main administrator (`is_temporary = false`) can render the form or call `POST /api/admin/documents/generate`. Additional administrators receive no navigation item; the server rejects direct requests. The form accepts three labelled or ordered lines (date, full name, address) in PL/RU/EN, lets the owner review the fields, then downloads a Polish PDF. Candidate fields and generated PDFs are not stored on the server.

The contract text and supplied company signature are private assets, **excluded from this public repository**. The server reads only the fixed private storage keys `system/documents/contract-v1/content.json` and `system/documents/contract-v1/company-signature.png`. Keep a separate private backup of these two assets. Fonts in `src/server/documents/assets` are unmodified Noto Sans, with their license included.

Provision the template from a directory outside the repository containing `contract-content.json` and `company-signature.png`:

```bash
node --conditions=react-server --import tsx scripts/provision-document-template.ts /absolute/private/template-directory
```

With `BLOB_READ_WRITE_TOKEN`, the script uses private Vercel Blob storage. For local development, append `--local` to seed ignored `.data`. On a standalone production host, set `UPLOAD_DIR` to a persistent private directory outside the web root before provisioning and starting the app. The script validates both assets, skips identical existing files, and refuses to overwrite a different immutable version. Provisioning does not require a database migration. Without the template, generation returns a safe unavailable response.

For a local PDF preview from a private JSON file with `date`, `fullName` and `address`:

```bash
node --conditions=react-server --import tsx scripts/preview-contract.ts /private/input.json /private/output.pdf
```

The generator retains the supplied contract wording and numbering. Changes to contract terms require a separate template revision.

## Changing the copy

- All texts, the three questions, answer options, contact form labels, instructions, errors and statuses: `src/config/content.ts`.
- PDF: replace `public/Rejestracja_Ryanair_Instrukcja.pdf` or point `content.task.pdf.url` elsewhere.
- Automatic message text, delay, on/off and chat attachments: `/admin/settings` (stored in the database).
- Upload limits: `src/config/settings.ts` or `NEXT_PUBLIC_MAX_FILE_MB`, `NEXT_PUBLIC_MAX_FILES`. Max file size is 4 MB because Vercel functions accept request bodies up to 4.5 MB.


## Reliability fixes and hosting

See `HOSTING-RU.txt` for deployment instructions in Russian and `FIXES-RU.txt` for the change and verification report.

- Chat messages have a database sequence assigned while holding the visitor row lock. Polling advances only from received pages, never from a send response. Both interfaces show the latest 100 messages and provide a button to load older pages.
- Migration `0004_message_sequence.sql` is required before starting this version. It preserves existing messages and assigns historical sequence values in chronological order. Apply migrations with a backup and deploy schema before the new application. Older application instances should be stopped during this update because the old sender code does not take the new visitor lock.
- Automatic message claim, insertion and completion are atomic. The backup sweep also recovers expired `sending` locks left by older code.
- Review invitations unlock the form and insert the chat message in the same transaction.
- Upload limits, submission attachment and draft deletion share the visitor lock; concurrent requests cannot attach a file after it was deleted or exceed the upload count. Removed chat attachments are deleted from storage.
- On Vercel, use private Blob storage. On a standalone Node server, set `UPLOAD_DIR` to an absolute directory on a persistent volume, or use Blob. A production server without either configuration refuses local uploads rather than silently using ephemeral storage.
- On non-Vercel hosts, configure `APP_URL` and an external authenticated schedule for `/api/jobs/sweep`. `vercel.json` is only executed by Vercel. The bundled daily cron is a fallback; QStash handles the configured 30–60 second delivery.
- Preview callbacks use their own deployment URL unless `APP_URL` explicitly overrides it. Use a separate preview database and reachable callback URL; do not connect previews to the production database.

`npm run typecheck` generates route types before invoking TypeScript. `npm test` includes regression tests for pagination, duplicate timestamps, parallel uploads, stale delivery locks, transactional review invitations, authorization, password session invalidation, request limits and upgrade migrations.

## Public reviews

Manage reviews in Admin -> Reviews -> Site reviews: add a name, optional city and age, 1-5 stars and review text. Save as a draft or publish; existing reviews can be edited, hidden or deleted. Only published reviews appear on the landing page. The final visitor screen contains the submission confirmation and chat, without a review form or invitation. Legacy visitor review records remain available to administrators.

## HR assignment

The managers table stores Aneta, Maja, Hanna and Agnieszka with the supplied portraits. New leads receive one random manager in the database on their first insertion. That identity is reused for system replies and all admin replies shown to the visitor, including after a reload. Existing leads retain Aneta through migration0006. The assigned manager is visible in the admin lead list and details.

## Candidate result and chat hours

The internal `rejected` status is labelled “Не подходит” / “Nie zakwalifikowano” / “Not suitable”. It does not notify the visitor by itself. For a submitted task, the lead page provides an editable Polish result, the visitor card preview, and explicit publish/retract actions. Publication replaces the final waiting card with the result and closes the candidate chat. Direct candidate message and chat attachment requests receive HTTP403 `candidate_chat_closed`; history and files stay available to the admin. Updates arrive through existing polling and restore through the visitor session on reload. Polling continues while the chat is hidden, so retracting the result or changing the status away from `rejected` reopens the chat without a reload.

The published rejection keeps the usual dark background and green AlleyBiz logo, with a soft burgundy bottom glow. Completed steps use neutral gray; Gotowe with its cross and the result card use a subdued red accent. The card includes a quiet sad icon and no invitation to chat. The burgundy bottom glow applies only while a published rejection is visible; retracting it restores the green glow. Other screens keep the green theme. The admin sidebar, mobile header, login and tab title use the green mark and exact label `AlleyBiz /adminka`.

Lead status colours are shared across the admin table, active filter, detail badge and status buttons: new = blue, in progress = orange, awaiting reply = violet, completed = green, not suitable = red. Status labels remain visible and native select keyboard behaviour is preserved.

Apply migration `0007_candidate_outcome.sql` before starting this version. Existing rejected leads remain unpublished. Publication cancels unsent automatic greetings while holding the same visitor lock as delivery. Retraction does not restart cancelled jobs. Already sent messages remain in history.

Visitor and admin timestamps use `Europe/Warsaw`, including daylight saving changes. The visitor chat states that replies are provided from 10:00 to 18:00 Polish time. This is an informational label, not a restriction on sending messages or automatic replies. Visitor recovery still uses the existing browser cookie; email login has not been added.
