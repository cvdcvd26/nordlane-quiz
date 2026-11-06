# Move to IT Solution and retire the old hosts

Main application: `https://itsolution.fun`.
Preland: `https://land.itsolution.fun`.

The final requirement is **no old site, no redirect and no cross-domain session
migration**. Set `LEGACY_SITE_RETIRED=true` once the new domain and workers are
ready. Every path on these previous production aliases then returns HTTP 410:

- `alleybiz.vercel.app`
- `nordlane-quiz.vercel.app`
- `nordlane-quiz-alley9.vercel.app`
- `nordlane-quiz-git-main-alley9.vercel.app`

This includes the homepage, quiz, admin login, APIs, private files, static assets
and former recovery endpoints. There is no `Location` header, new-domain link,
application UI or cookie issuance. The response is non-cacheable and marked
`noindex, nofollow`. Keep the aliases attached to serve this explicit closure;
do not configure a platform-level redirect that would run before the Proxy.

`LEGACY_SITE_RETIRED=true` also forces the session-recovery feature off even if
an older environment still has `SITE_DOMAIN_MIGRATION_ENABLED=true`. Keep
`SITE_DOMAIN_MIGRATION_ENABLED=false` in the final environment. The new site
opens directly and never checks cookies at the previous host.

## Release order

1. Preserve the database and file store. Deploy the code with retirement and
   candidate email disabled until the new site is ready.
2. Attach the new domain to the same application and configure DNS/TLS. Set
   `APP_URL=https://itsolution.fun`; keep `SITE_DOMAIN_MIGRATION_ENABLED=false`.
3. Confirm queue consumers and the protected maintenance sweep work through the
   new deployment. Keep existing Vercel Queue topics unchanged. Vercel Queue
   delivery is configured by the deployment, not by `APP_URL`.
4. Inspect any previously scheduled QStash jobs with a fixed old callback URL.
   Reschedule them for the new origin before retirement; old URLs will return
   410 and will not be redirected or silently acknowledged. New QStash jobs use
   `APP_URL`. Run the protected recovery sweep on the new origin to recover
   durable overdue work. The daily sweep alone is not a timely delivery timer.
5. Set `LEGACY_SITE_RETIRED=true` and redeploy. Check all four old aliases return
   410, while the main site and new admin login work normally.
6. Enable candidate email separately after sender, queue and delivery checks in
   `docs/brevo-setup.md`.

## Existing data and access

No lead, chat, answer, attachment, status, manager or account is deleted or copied.
The new administrator panel uses the same database and private file storage and
shows the existing history after the administrator signs in at the new address.
Administrator cookies are never transferred.

Old anonymous host-only cookies cannot authorize a browser on the new domain.
With recovery intentionally disabled, old anonymous candidates are not linked
automatically by phone or name. Candidates with an already verified email account
can restore that account through email login once enabled. Existing anonymous
history remains available to administrators, but a new anonymous submission is
a separate application. Previously issued transferred credentials, if any, remain
valid until their normal expiry; retirement does not revoke or alter stored data.

The additive 0022 tables may remain in the database. No cleanup, rollback or
deletion migration is needed when disabling the unused recovery feature.

Campaign tags and `fbclid` can reach the new site directly through the decorated
preland CTA. The new preland is recognized as a separate referral source.

## Verification

Run `domain-retirement`, `domain-session-transfer`, `domain-migration-routing`
and `maintenance-proxy` tests. After deployment, verify HTTPS 410 without a
`Location` header for old public/admin/API/static routes; test a fresh visit to
the new domain without a round trip to an old host. Confirm existing data and
attachments through the new admin panel and check background queue delivery.
