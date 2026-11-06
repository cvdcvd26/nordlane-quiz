# Move to IT Solution

Main application: `https://itsolution.fun`.
Preland: `https://land.itsolution.fun`.
Legacy recovery origin: `https://alleybiz.vercel.app`.

Deploy migration `0022_domain_session_transfer` with
`SITE_DOMAIN_MIGRATION_ENABLED=false` first. The old public site continues to
work until DNS/TLS and the new-origin deployment are ready. Then set
`APP_URL=https://itsolution.fun` and `SITE_DOMAIN_MIGRATION_ENABLED=true`.
Do not configure a blanket Vercel domain redirect: the old origin must still
serve the recovery endpoint, private file APIs and outstanding queue callbacks.
The application Proxy redirects old public pages itself; there is no standalone
old frontend after activation. Admin pages redirect to the new login page and
require a new login. Administrator cookies are never transferred.

## Candidate session recovery

The first visit to the new host creates a five-minute browser-bound request,
then checks the existing host-only cookie at the old host. The old host issues
a single-use 90-second grant in a URL fragment. The isolated finish page clears
the fragment before any network request, and redeems it with an HttpOnly,
Secure, `__Host-` nonce through a strictly same-origin POST. Raw session cookies
and grants are not stored in the database or query strings. All recovery
responses are non-cacheable and suppress referrers, external assets and framing.

The new credential points to the same application ID: contacts, answers, files,
messages, statuses and managers are not copied or merged. The old credential
remains valid; the new credential cannot outlive it. Binding an email account
rotates the parent guest credential and invalidates all transferred guest
credentials. Existing populated new-host applications are never overwritten.
Recovery does not create an account, visitor session or lead on its own.

A functional checked cookie prevents repeat round trips. Recovery failures show
a retry link and an explicit option to continue without restoring a session.
Cleared/expired old cookies, a different browser/device, or an unreachable old
origin cannot be recovered automatically. Verified candidates can instead use
email login when that feature is enabled. There is no phone/name-based matching.

Campaign UTM labels and `fbclid` survive the redirect chain; arbitrary queries,
fragments and private paths do not. The old/new main hosts count as internal
referrals and `land.itsolution.fun` is recognized as the separate preland.
Transferred guest applications suppress replay of already completed Meta
conversion stages just like restored email accounts. Cookie-consent settings
are not copied between origins.

The first-visit recovery redirects suppress the original browser referrer;
use the existing decorated preland CTA/Meta campaign UTM links for attribution.
Recovery state older than a day and expired transferred guest credentials are
removed in bounded batches when a new recovery starts. Existing application
records are never removed by this cleanup.

## Verification

Run the focused `domain-session-transfer`, `domain-migration-routing`,
`candidate-email-auth`, `meta-pixel` and `maintenance-proxy` tests before
activation. Verify one synthetic old-host application through the real HTTPS
browser flow after DNS is ready, including chat/private attachment access.
Keep the activation flag off if that check fails; do not remove the old alias.
