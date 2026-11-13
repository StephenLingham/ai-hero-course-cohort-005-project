# Throwaway Knock vendor-fit prototype

Asset for [Does Knock hold up against Cadence?](https://github.com/StephenLingham/ai-hero-course-cohort-005-project/issues/18),
within [Wayfinder: In-app notifications for Cadence](https://github.com/StephenLingham/ai-hero-course-cohort-005-project/issues/9).
This branch is not production implementation and must not be merged.

## Run offline

From the repository root, run `npm run prototype:knock`, then open
`http://127.0.0.1:5173/prototype/knock` (use the actual port printed if occupied).
Requires Node.js 22.9+ and the existing seeded development database.
No Knock account, keys, workflow, provider or additional setup is needed.
Leave `KNOCK_PROTOTYPE_MODE` unset, or explicitly set it to `offline`.
The runner loads the gitignored `.env`; credentials alone never enable live mode.

1. Select a user in the floating DevUI panel. The page shows their namespaced
   subject and an SDK-signed RS256 token summary, locally verified against an
   ephemeral RSA key. The key is **not** registered with Knock. No key or token
   value is sent to the browser.
2. Replay one of their existing Discussion Replies. The recipient comes from
   the original Discussion Question, not a submitted recipient ID. Deleted
   comments, self-notifications and Instructor top-level comments are excluded.
   This is a replay, not an actual new comment or a production event hook.
3. Switch to that recipient. Inspect their feed, mark the item seen, then read,
   and inspect the counts and timestamps. Switch away and back to verify
   per-user separation.
4. Replay an existing new Enrollment as its Student, then switch to its
   Instructor. It is suppressed initially. Opt into `in_app_feed`, switch back
   to the Student and replay again; inspect the Instructor's new item.
5. Toggle email and push independently and inspect the category/channel JSON.
   These controls do not provision or deliver email or web push.

Offline feeds and preferences live only in server memory. A restart or a
server-module hot reload wipes them. The application database is read-only
from this harness. It never writes comments or Enrollments.

**Offline results cannot pass any of the four vendor-fit checks.** They verify
the harness and support the human discussion, not Knock's behavior.

## Resume against Knock later

First finish [Sign up for the notification vendor and provision dev keys](https://github.com/StephenLingham/ai-hero-course-cohort-005-project/issues/14).
Use only a Free **Development** environment with synthetic test data and enhanced
security enabled. Do not copy secrets into GitHub, chat, source or browser code.

In the gitignored `.env`, retain the setup wizard's settings:

- `KNOCK_ENVIRONMENT=development`
- `KNOCK_PUBLIC_API_KEY`
- `KNOCK_SECRET_API_KEY`
- `KNOCK_SIGNING_KEY` (base64 PEM or raw PEM, RSA 2048+)
- `KNOCK_DASHBOARD_URL` (setup reference only; not read by this harness)

Before enabling live mode, configure in the Knock Development dashboard:

- An in-app feed channel; record its ID as `KNOCK_FEED_CHANNEL_ID`.
- An in-app-only workflow keyed `cadence-prototype-discussion-reply`.
- An in-app-only workflow keyed `cadence-prototype-new-enrollment`, categorized
  `prototype-enrollment`. Enable optional preference evaluation; no mandatory
  delivery override or batching/delays for this spike.
- Environment-level category/channel defaults for `prototype-enrollment` off
  for `in_app_feed`, email and push, with per-user opt-in allowed.
- A simple feed body such as `Prototype {{ data.event_type }} event {{ data.event_id }}`.
- Commit the workflows/settings into Development as required by the dashboard.
  Do not promote anything to Production.
- Identify test recipients `cadence-prototype-user-<local user ID>` in
  Development, with IDs only. Use separate synthetic recipients so their
  existing overrides cannot mask the environment defaults. Triggering also
  inline-identifies its actor and recipient without names or email addresses.

Dashboard availability, exact default-preference configuration, and delivery
behavior remain **unverified prerequisites**, not promises from this scaffold.
If the proposed category/channel opt-in configuration cannot actually be
expressed and verified, that fails the preferences gate.

Then set `KNOCK_PROTOTYPE_MODE=live` and restart the same command. Live mode
fails explicitly on missing configuration; it never substitutes simulation.
Read/seen/preferences and feed requests use a **public key plus the
session-selected user's signed token**, not the secret key. The Node SDK
secret key is used only to replay workflows. All calls are server-side through
this same-origin harness; direct browser SDK/CORS behavior is not tested here.
Token expiry is 15 minutes; each request signs a fresh token. This does not
decide a production refresh strategy.

### Required live evidence before deciding

| Gate                          | Evidence to capture on the ticket                                                                                                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed identity and switching | Local RS256 summary matches each selected user; authenticated feed probe returns 200; missing-token and cross-user probes return 401/403; switching never shows another user's feed.                                                                                                           |
| Real triggering               | Replay an actual eligible Discussion Reply; record the SDK workflow run ID, then locate its matching `data.event_id` in the question author's actual Knock feed. Accepted triggers alone are not delivery evidence.                                                                            |
| Headless API                  | Record actual listing/count responses and before/after read and seen timestamps, including unread/unseen counts. The page displays the first feed page and vendor-wide metadata; this is not a pagination UX.                                                                                  |
| Preferences                   | With a fresh Instructor, demonstrate new Enrollment suppression with no per-user opt-in, then delivery after opt-in. Read the actual saved category/channel preference; opt out again and verify suppression. Verify independent channel settings without signing up for email/push providers. |

Use the **Probe token isolation against Knock** action for actual rejection
statuses. It is disabled offline. Unexpected statuses are failures to
establish security, not a green result. Knock runs workflows asynchronously:
switch recipients and refresh rather than interpreting an immediate empty
feed as a delivery failure. Check workflow runs and allow a bounded observation
window before deciding whether a gate failed.

The human-led ticket stays open until all four gates have live evidence and
the verdict is discussed. Missing access is a blocker, not vendor failure.
An actual failed gate reopens the vendor choice with Courier as the fallback.

## Boundaries and sources

The route is development/localhost-only; actions require a same-origin request.
The host restriction and `KNOCK_ENVIRONMENT` guard do not prove which environment
an API key belongs to: the human must confirm that in the dashboard.
Do not expose the dev server publicly or deploy this branch. Existing DevUI
authentication is development impersonation, not production authentication.
There are no retries, outbox, production user sync, templates, event hooks,
Notification Feed UI design, or production notification storage decisions here.

- [Knock security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication)
- [List feed items and metadata](https://docs.knock.app/api-reference/users/feeds/list_items)
- [Update preferences](https://docs.knock.app/api-reference/users/set_preferences):
  writes default to replacement; this harness explicitly requests merge.
- [Knock Node SDK and token signing](https://github.com/knocklabs/knock-node)
