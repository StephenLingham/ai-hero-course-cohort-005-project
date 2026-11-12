# Knock evidence for Cadence's first in-app notifications

**Evidence accessed: 2026-11-12.** Research for [Assess Knock for Cadence's in-app notifications](https://github.com/StephenLingham/ai-hero-course-cohort-005-project/issues/4), labelled `wayfinder:research` and already assigned to StephenLingham, under [Specify Cadence's first in-app notifications](https://github.com/StephenLingham/ai-hero-course-cohort-005-project/issues/2). This is evidence, not an approved spec or provider selection.

## Scope and evidence standard

The map calls for a small release of useful in-app updates or things needing attention. Students, Instructors, Team Admins, and Platform Admins remain eligible for consideration; no event, recipient set, behavior, provider, or UI has been chosen. Email, SMS, push, marketing, and engagement nudges are outside scope. No production volume or budget is supplied.

Labels below distinguish **DOC** (documented capability, not independently tested), **SOURCE** (observed official source code), **PLAN** (commercial/configuration dependent), **GAP** (not established by the reviewed documentation), **UNTESTED** (requires an integration/runtime check), **ASSUMPTION** (supplied context, not independently audited), and **INFERENCE** (Cadence-facing consequence, not a vendor guarantee).

**ASSUMPTION:** The supplied baseline is React 19.2, React Router 8.3 with SSR, TypeScript, SQLite/Drizzle, Node 22+, and no installed Knock dependency. This research used public official docs, legal pages, and pinned official SDK source only. No account, vendor credentials, dependency installation, app changes/checks, personal-data upload, or paid commitment was made.

## Findings in brief

- **DOC:** Knock has asynchronous workflow triggers, persisted per-recipient feeds, status/count APIs, managed websocket updates, and prebuilt or headless React UI. These are documented mechanisms for an in-app release, not proof of fit for still-open Cadence requirements. [Trigger API][trigger] [Feeds][feeds] [In-app API][inapp] [React UI][react]
- **DOC / INFERENCE:** Production isolation is not the getting-started default: enhanced security must be enabled, and Cadence must issue user-bound tokens and authorize any tenant grants. A feed filter alone is not an authorization boundary. [Authentication][auth] [Tenant scoping][tenants]
- **SOURCE / UNTESTED:** React 19.2 is inside the SDK's declared React peer range. React Router 8.3 SSR, hydration, lifecycle cleanup, and navigation are not thereby certified. [React manifest][manifest] [Authentication hook][authhook]
- **PLAN / GAP:** Free currently includes 10,000 sent messages/month; Starter starts at $250/month. Feed content is retained indefinitely according to the retention docs, while debugging logs expire. Latency guarantees, configurable feed expiry, and complete deletion/backup timing are not established here. [Pricing][pricing] [Retention][retention]
- No alternative was investigated: the concrete restrictions below do not yet conflict with an agreed Cadence requirement. An alternative comparison becomes warranted if a human requirement conflicts with one of them; this report does not select Knock.

## 1. Workflows, event triggers, and responsibility

**DOC:** `POST /v1/workflows/{key}/trigger` runs a workflow asynchronously and returns `workflow_run_id`, not confirmation that a user saw a notification. Payloads support recipient identifiers or inline identification, optional actor, JSON data, tenant, cancellation key, and settings. Inline identification precedes the recipient's workflow execution. A workflow/channel step can produce no message because of conditions or preferences. [Trigger reference][trigger] [Trigger payload][payload] [Debugger][debug]

**DOC:** Event-triggered workflows use configured Sources, including CDPs and HTTP webhooks. Event-to-action mappings can identify users and trigger workflows for one or more recipients; an event-triggered workflow can still be called directly by API. A source integration is not required merely to call the trigger API. [Event triggers][events] [Event streams][streams]

**INFERENCE, not a selected architecture:** A later boundary could keep Cadence responsible for domain-event truth, permission-aware recipient selection, and minimum payloads, with Knock responsible for the configured workflow and feed delivery. These APIs do not determine which Students, Instructors, Team Admins, or Platform Admins should receive which event. Nor do they establish an atomic transaction between Cadence's SQLite commit and Knock: durable handoff/outbox, replay, and correlation requirements remain for the service-boundary decision.

## 2. Recipient identity, authentication, and isolation

| Evidence | Constraint for a later design |
| --- | --- |
| **DOC:** A user's only required attribute is a stable unique `id`; email, phone, name, and avatar are optional. IDs are immutable, at most 256 characters, and cannot contain `/` or `#`. [Users][users] | An internal identifier can support in-app-only use without supplying contact details. IDs are still user-related data; pseudonymous does not mean anonymous. |
| **DOC:** Enhanced security is **off by default**. With it off, a public-key request can act as any user. With it on, client requests require a backend-signed RS256 JWT with `sub`; expiry is recommended. [Authentication][auth] | Production must not copy the unauthenticated quick-start posture. Derive the token subject from Cadence's authenticated server session, not a client-supplied recipient ID. |
| **DOC:** `explicit_grants: true` restricts token permissions; otherwise default access remains broad. Feed read/write grants and tenant-scoped grants are supported. Tenant-restricted feed reads deny other tenant scopes, including nil unless separately granted. [Authentication][auth] | Cadence owns membership/role checks before issuing grants. Choose minimum permissions, token lifetime/refresh, and logout/revocation expectations; do not infer immediate session revocation from JWT expiry support. |
| **DOC:** Trigger and feed `tenant` parameters scope feed results, badge counts, and real-time notifications. Base tenants work on every plan; per-tenant preferences/branding are Enterprise features. [Tenant scoping][tenants] [Plans][plans] | Tenant filtering and signed tenant authorization are separate concerns. Test cross-user, cross-tenant, unscoped, and workspace-switch access. |

**DOC:** Secret API keys can perform any Knock API request and cannot currently be narrowed to selected resources. Public keys identify the environment; signing keys and secret API keys belong on the backend. Tokens can refresh through `onUserTokenExpiring`; reauthentication restarts the real-time connection. [API keys][keys] [Authentication][auth]

## 3. Feed persistence, states, and counts

**DOC:** Feed messages are generated ahead of display and retrieved as a paginated, reverse-chronological per-user feed, including `total_count`, `unread_count`, and `unseen_count`. Filtering includes status, archived state, tenant, workflow/category, trigger data, and date bounds. This is a stored feed, not only a transient websocket toast. [Feeds][feeds] [Feed endpoint][feedapi]

| State/operation | Documented meaning and caution |
| --- | --- |
| Seen | Separate from read: retrieved/displayed rather than explicitly engaged with. Prebuilt feed popovers mark all as seen on opening; headless consumers must choose and implement seen updates. [Statuses][statuses] [Headless UI][headless] |
| Read | Explicitly marked read; default components support click and mark-all behavior. The default badge is **unseen**, not unread; `badgeCountType="unread"` changes it. Opening the feed need not clear unread items. [Feed integration][feedintegration] [React feed][reactfeed] |
| Archived | Hidden from the default list, still retrievable and unarchivable. Archiving is not deletion. [Archive API][archive] |
| Bulk operations | SDK updates are optimistic. Mark-all operations cover all feed items in the current scope, not merely the loaded page, and are deferred server-side. Failure/reconciliation behavior must be tested. [Feed client][feedclient] |

**DOC restriction:** Generated feed content and metadata cannot be edited; only engagement status can change. Documented replacement is archive plus a new workflow trigger. **INFERENCE:** If a later scenario needs live-changing task state, content correction, or access removal, that requirement must explicitly accommodate or reject this model. A notification is not authority to access its linked Cadence resource. [Feeds FAQ][feeds]

**DOC / GAP:** The feed endpoint documents HTTP `mode` defaulting to `rich`; React headless docs describe SDK default `compact`, omitting nested data/activities and all but one actor. Specify the mode deliberately rather than depending on a cross-layer default. [Feed endpoint][feedapi] [Headless UI][headless]

## 4. UI and React Router SSR

**DOC:** `@knocklabs/react` provides feed, popover, icon/badge, and inbox building blocks; hooks/client APIs support fully custom UI. CSS variables/styles and item/click render overrides are available. These options do not choose a bell, dropdown, panel, inbox, or persistence policy for Cadence; the later human-led prototype still owns that choice. [React UI][react] [React feed][reactfeed] [Headless UI][headless]

**SOURCE:** Official JavaScript source was pinned at `07c61ac3ef1c968731ea9b83d81193f254ed1761`. Its React manifest declares version `0.15.1`, React/React DOM peers `^17 || ^18 || ^19`, TypeScript declarations, CJS/ESM exports, and optional Next/TanStack integrations. React 19.2 satisfies that range; no React Router adapter is declared. This is a source snapshot, not verification of the currently published npm tarball. [Manifest][manifest]

**SOURCE / INFERENCE:** The authentication hook constructs/authenticates a client during render; inline identification can issue an API request. The client guards websocket creation with browser checks, but that is not proof of side-effect-free SSR. Providers support `enabled={false}` to keep the client idle until identity/token readiness. An authenticated, post-hydration browser boundary is a candidate to validate, not an implemented solution. Keep per-request server data and browser stores isolated. [Authentication hook][authhook] [Client authentication][clientauth] [Client API][clientapi] [Provider docs][provider]

**DOC / UNTESTED:** React Router's `.server` convention protects server-only code from client bundles. `.client` exports are undefined on the server and require appropriate effect/event or hydrated rendering use; renaming a route or directly rendering an undefined client export is not a solution. Validate SSR imports, hydration, CSS, Strict Mode, token readiness/refresh, logout/user/tenant switches, and cleanup in Cadence before declaring compatibility. [Server modules][rrserver] [Client modules][rrclient]

**SOURCE:** Default notification navigation uses delayed `window.location.assign`, whereas a supplied click handler takes over navigation. React Router navigation therefore needs an intentional handler and resource authorization, not an assumed router integration. [Notification cell][cell]

**DOC/SOURCE discrepancy:** One feed guide says to pass `userToken` to `KnockFeedProvider`; the authentication docs and actual props place it on **`KnockProvider`**. Use versioned types/source rather than that sentence. [React feed][reactfeed] [Provider source][providersource] [Feed-provider source][feedprovidersource]

**DOC:** The official Node SDK supports non-EOL Node 20 LTS or later and TypeScript >=4.9; Node 22 fits that stated runtime range. JWT signing uses `jose`, with CJS/ESM caveats. No SDK/runtime combination was installed or tested here. [Pinned Node README][node]

## 5. Real-time delivery, latency, retries, and observability

- **DOC:** Managed websockets emit `new-message` with badge metadata, not full content; events may be throttled. SDKs manage reconnects. Inactive-tab disconnection is configurable; cross-browser updates are documented as experimental. A persisted-feed fetch remains necessary. **GAP:** No numeric trigger-to-visible latency, reconnect catch-up bound, cross-device consistency guarantee, or exactly-once display guarantee was established in these sources. [In-app API][inapp] [Socket behavior][socket] [React socket options][reactfeed]
- **DOC:** In-app `delivered` means available in the recipient's feed, **not rendered or read on a device**. A successful trigger is asynchronous and can precede a later workflow failure. [Statuses][statuses] [Trigger API][trigger]
- **DOC:** Trigger idempotency uses an explicit `Idempotency-Key` (up to 255 characters), identical parameters, and a 24-hour window. Only successful `2xx` responses are cached; the header currently applies only to workflow triggers. Source-event deduplication is separately configured, also normally 24 hours; invalid source keys do not deduplicate. These are not permanent business-event deduplication. [Idempotency][idempotency] [Event streams][streams]
- **DOC:** Distinct retry layers must not be conflated: the Node SDK retries selected connection/408/409/429/5xx failures twice by default; workflow-step failures get up to three total attempts, then halt; downstream sending retries up to eight times over 30 minutes. The downstream policy does not promise websocket replay or browser rendering. [Node README][node] [Debugger][debug] [Delivery][delivery]
- **DOC:** API logs, workflow debugger, per-recipient runs, skipped-step reasons, message events, and outbound webhooks provide visibility. Failed workflow runs may be manually retried once within seven days, from the failed step and original workflow version. Completed steps do not rerun. Webhooks have signatures and their own retry/log behavior. **PLAN:** Datadog/other streaming observability extensions are Enterprise-gated; dashboard logs exist on Free. [Debugger][debug] [Webhooks][webhooks] [Plans][plans] [Pricing][pricing]

**INFERENCE:** A later spec must choose tolerated delay, durable event correlation/retry ownership, stale/unavailable feed UX, and recovery after optimistic state changes. None is solved merely by selecting the SDK.

## 6. Setup, current pricing, and developer limits

**DOC; not performed:** Setup requires a Knock account/environment, an in-app channel, a workflow with an in-app step/template, publishing that workflow, recipient identification, browser public key/channel ID, and a backend secret for real triggers. Production client access additionally needs a signing key and enhanced security. A source-event integration is optional. [React quick start][quickstart] [API keys][keys] [Authentication][auth]

**PLAN:** Current public pricing in dollars, accessed 2026-11-12; recheck before any commitment. No production cost estimate is possible without recipients, event frequency/fanout, and an agreed budget. [Pricing][pricing]

| Plan | Relevant published allowance/cost |
| --- | --- |
| Free, formerly Developer | $0/month, no credit card required; up to **10,000 messages sent/month**. Unlimited stored profiles, workflows, channels, team members, and feeds per recipient. Prebuilt/custom UI and basic multi-tenancy included; removing Knock branding not included. |
| Starter | **$250/month**, includes 50,000 sent messages; additional messages **$0.005 each**. Includes branding removal and priority email support. |
| Enterprise | Custom quote; volume/alternative monthly-notified-user pricing, longer logs, advanced tenant/security/observability features and enterprise SLAs. No invented minimum spend. |

**DOC:** Billing counts a successful message to one user on one channel, not a workflow trigger or feed view. Fanout counts per recipient. Free is not a hard message cap: the FAQ says Knock contacts customers who exceed it without a billing method. Guides have separate allowances (Free 500 recipients; Starter 2,500 then $0.05 each); guides are not required for workflow-generated feeds. [Pricing FAQ][pricing]

**DOC:** Usage may accrue in **any environment**. The plans FAQ explicitly says in-app feeds **do not support sandbox mode**; isolate tests and use channel conditions rather than assuming test deliveries are free. [Plans][plans]

**DOC:** Rate limits are endpoint-specific, separate from monthly billing: trigger is tier 5 (**1,000 requests/second**), normally environment-scoped; feed listing is tier 2 (**5 requests/second**) per user and environment, even without signed tokens. `429` indicates throttling. Batch/bulk deduplication limits can also omit updates while returning `2xx` with `x-ratelimited-*` headers. These limits are not demonstrated Cadence capacity or latency guarantees. [Trigger reference][trigger] [Feed endpoint][feedapi] [Rendered rate-limit reference][rates]

## 7. Data handling, privacy, retention, and deletion

| Area | Verified documentation and remaining constraint |
| --- | --- |
| Payload exposure | **DOC:** Knock stores identified-user properties, message content, and trigger data. Feed responses can include actor/recipient properties, public variables, and trigger data. Channel-level API response filters can restrict returned fields. **INFERENCE:** Send only minimum authorized data; response filtering does not mean Knock never stored the excluded data. [Users][users] [Feed integration][feedintegration] |
| Logs versus feeds | **PLAN/DOC:** Message/workflow/source/outbound-webhook logs: 30 days on non-Enterprise, 90 on Enterprise; API logs: 30 days for all. Expired data becomes inaccessible and is eventually pruned. **Feed items remain available indefinitely**, including status updates after message logs expire. [Retention][retention] |
| Feed expiry control | **GAP:** Pricing says unlimited feed retention “can be configured,” but retention docs say custom retention policies are not currently supported and do not establish a self-service feed-expiry mechanism. These may describe different controls; do not assume an adjustable expiry window. Archiving only hides items. [Pricing][pricing] [Retention][retention] [Archive][archive] |
| Individual user deletion | **DOC:** Hard-delete API removes user properties, preferences/channel data/subscriptions/schedules, messages, and associated activity/run logs; processing can take up to 10 minutes. Reusing the ID creates a fresh user, not a permanent suppression record. **GAP:** This does not establish scrubbing of copies of an actor's data embedded in other recipients' messages or all backups. [Deleting users][deleteusers] |
| Privacy controls | **DOC:** Environment obfuscation hides data from dashboard members but leaves underlying data intact. Filtered log keys apply on write, not retroactively, and do not remove rendered message content or stored user/message records. Permission-group obfuscation is Enterprise-only. [Data obfuscation][obfuscation] |
| Security/residency | **DOC, vendor assertions:** Security page states encryption at rest, TLS 1.2 cross-service communication, SOC 2 Type 2 and privacy compliance claims, and server logs retained at most one year. These server logs are not the same documented category as 30/90-day product logs. EU residency is still described as expected by end-2026, **not currently verified available**. Subprocessors list US locations. [Security][security] [Retention][retention] [Subprocessors][subprocessors] |
| Legal and complete erasure | **DOC:** End-user notification data is processed on the customer's instructions; the website privacy policy is not the end-user processing policy. The DPA addresses subprocessors/international transfers, says no sensitive data in Annex I, and permits requesting return within 90 days after termination, with remaining-copy deletion within 180 days after return unless law permits/requires otherwise. Account-deletion docs separately say removal after 24 hours. **GAP:** Reconcile these scopes and backup deletion with the vendor before promising a comprehensive erasure deadline. [Privacy policy][privacy] [DPA §§2–3, 6, 9, 12 and Annex I][dpa] [Account deletion][deleteaccount] |

**UNVERIFIED:** SOC/penetration-test artifacts were not reviewed; the public Trust Center returned an application shell. Compliance statements are not an independent legal/security approval. The subprocessor list includes AI providers, but does not establish that ordinary feed payloads reach them; no such routing or zero-AI-processing guarantee is inferred. [Trust Center][trust] [Subprocessors][subprocessors]

## Handoff: unresolved decisions and bounded proof

This report supplies evidence to the human-owned service-boundary decision; it does not resolve it or any other decision ticket.

1. **Humans:** Choose meaningful events/recipients across the considered roles, behavior and urgency, provider/responsibility boundary, acceptable cost, and UI through the planned prototype.
2. **If Knock remains a candidate:** Agree whether immutable content, indefinite feed persistence, branding/plan constraints, and current residency evidence fit those choices. Seek vendor clarification only where a chosen requirement makes a documented gap material.
3. **Later authorized proof, not performed here:** Validate React 19.2/React Router 8.3 SSR and hydration, secure user/tenant isolation including session switches, token expiry, pagination/count/state semantics, lost connections, duplicate triggers, failures, and required deletion scope. Account access is a prerequisite requiring separate authorization, not silently provisioned.

Publication is intentionally a report-only throwaway research branch, with no PR, merge, or production implementation. Per the driving session's instructions, final issue resolution/closure and the map's decision-index update are left to that session after reading this report.

## Official sources

All sources below were accessed **2026-11-12**. Public docs/pricing/legal pages can change; SDK source links are pinned.

[trigger]: https://docs.knock.app/api-reference/workflows/trigger.md
[payload]: https://docs.knock.app/send-notifications/triggering-workflows/api.md
[events]: https://docs.knock.app/send-notifications/triggering-workflows/events.md
[streams]: https://docs.knock.app/integrations/sources/streams.md
[users]: https://docs.knock.app/concepts/users.md
[auth]: https://docs.knock.app/in-app-ui/security-and-authentication.md
[keys]: https://docs.knock.app/developer-tools/api-keys.md
[tenants]: https://docs.knock.app/multi-tenancy/tenant-scoping.md
[feeds]: https://docs.knock.app/in-app-ui/feeds/overview.md
[inapp]: https://docs.knock.app/in-app-ui/api-overview.md
[feedapi]: https://docs.knock.app/api-reference/users/feeds/list_items.md
[statuses]: https://docs.knock.app/send-notifications/message-statuses.md
[archive]: https://docs.knock.app/api-reference/messages/archive.md
[feedclient]: https://docs.knock.app/in-app-ui/javascript/sdk/feed-client.md
[feedintegration]: https://docs.knock.app/integrations/in-app/feeds.md
[react]: https://docs.knock.app/in-app-ui/react/overview.md
[reactfeed]: https://docs.knock.app/in-app-ui/react/feed.md
[headless]: https://docs.knock.app/in-app-ui/react/headless/feed.md
[manifest]: https://github.com/knocklabs/javascript/blob/07c61ac3ef1c968731ea9b83d81193f254ed1761/packages/react/package.json
[authhook]: https://github.com/knocklabs/javascript/blob/07c61ac3ef1c968731ea9b83d81193f254ed1761/packages/react-core/src/modules/core/hooks/useAuthenticatedKnockClient.ts
[clientauth]: https://github.com/knocklabs/javascript/blob/07c61ac3ef1c968731ea9b83d81193f254ed1761/packages/client/src/knock.ts
[clientapi]: https://github.com/knocklabs/javascript/blob/07c61ac3ef1c968731ea9b83d81193f254ed1761/packages/client/src/api.ts
[provider]: https://docs.knock.app/in-app-ui/react/sdk/components/knock-provider.md
[providersource]: https://github.com/knocklabs/javascript/blob/07c61ac3ef1c968731ea9b83d81193f254ed1761/packages/react-core/src/modules/core/context/KnockProvider.tsx
[feedprovidersource]: https://github.com/knocklabs/javascript/blob/07c61ac3ef1c968731ea9b83d81193f254ed1761/packages/react-core/src/modules/feed/context/KnockFeedProvider.tsx
[cell]: https://github.com/knocklabs/javascript/blob/07c61ac3ef1c968731ea9b83d81193f254ed1761/packages/react/src/modules/feed/components/NotificationCell/NotificationCell.tsx
[rrserver]: https://reactrouter.com/api/framework-conventions/server-modules
[rrclient]: https://reactrouter.com/api/framework-conventions/client-modules
[node]: https://github.com/knocklabs/knock-node/blob/1ee56cb105ad87256b408c1106d173d62bb49889/README.md
[socket]: https://docs.knock.app/in-app-ui/feeds/socket-behavior.md
[idempotency]: https://docs.knock.app/api-reference/overview/idempotent-requests.md
[debug]: https://docs.knock.app/send-notifications/debugging-workflows.md
[delivery]: https://docs.knock.app/send-notifications/delivering-notifications.md
[webhooks]: https://docs.knock.app/developer-tools/outbound-webhooks/overview.md
[quickstart]: https://docs.knock.app/getting-started/quick-start/react.md
[pricing]: https://knock.app/pricing
[plans]: https://docs.knock.app/manage-your-account/knock-plans.md
[rates]: https://docs.knock.app/api-reference/overview/rate-limits
[retention]: https://docs.knock.app/manage-your-account/data-retention.md
[deleteusers]: https://docs.knock.app/managing-recipients/deleting-users.md
[obfuscation]: https://docs.knock.app/manage-your-account/data-obfuscation.md
[security]: https://docs.knock.app/developer-tools/security.md
[subprocessors]: https://knock.app/legal/subprocessors
[privacy]: https://knock.app/legal/privacy-policy
[dpa]: https://knock.app/legal/data-processing-addendum
[deleteaccount]: https://docs.knock.app/manage-your-account/account-deletion.md
[trust]: https://trust.knock.app
