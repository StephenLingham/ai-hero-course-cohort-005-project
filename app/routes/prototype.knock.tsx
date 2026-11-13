import { isRouteErrorResponse, Link, useFetcher } from "react-router";
import type { Route } from "./+types/prototype.knock";
import {
  prototypeContext,
  prototypeScenarios,
  prototypeSnapshot,
  runPrototypeCommand,
} from "~/lib/knock-prototype.server";
import { Button } from "~/components/ui/button";

export async function loader({ request }: Route.LoaderArgs) {
  const context = await prototypeContext(request);
  return {
    mode: context.mode,
    user: context.user,
    tokenSummary: context.tokenSummary,
    scenarios: prototypeScenarios(context.user.id),
    snapshot:
      context.mode === "offline" ? await prototypeSnapshot(context) : null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  return runPrototypeCommand(request);
}

export default function KnockPrototype({ loaderData }: Route.ComponentProps) {
  return (
    <Probe
      key={`${loaderData.mode}:${loaderData.user.id}`}
      loaderData={loaderData}
    />
  );
}

function Probe({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const snapshot = fetcher.data?.snapshot ?? loaderData.snapshot;
  const offline = loaderData.mode === "offline";
  return (
    <main className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">
          Throwaway Knock vendor-fit prototype
        </h1>
        <p className="font-semibold">
          {offline
            ? "OFFLINE: no vendor requests, no vendor-fit verdict."
            : "LIVE DEVELOPMENT: actions contact Knock and may consume free-tier messages."}
        </p>
        <p>
          Selected user: {loaderData.user.name} (user {loaderData.user.id}). Use
          the floating DevUI panel to switch.
        </p>
        <p>
          All four ticket checks remain pending until observed against Knock and
          reviewed with you. This is not a proposed Notification Feed design.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Signed identity (no credentials displayed)
        </h2>
        <pre
          data-testid="token-summary"
          className="overflow-auto rounded border p-3"
        >
          {JSON.stringify(loaderData.tokenSummary, null, 2)}
        </pre>
        <div className="flex gap-2">
          <fetcher.Form method="post">
            <Button name="intent" value="inspect" disabled={busy}>
              Refresh feed and preferences
            </Button>
          </fetcher.Form>
          <fetcher.Form method="post">
            <Button
              name="intent"
              value="security"
              disabled={busy || offline}
              variant="outline"
            >
              Probe token isolation against Knock
            </Button>
          </fetcher.Form>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Replay an existing catalogue event
        </h2>
        <p>
          Nothing is written to Cadence. Only the selected user&apos;s eligible
          existing events are replayable. Live payloads contain namespaced IDs
          and synthetic event data, not names, emails or Discussion text.
        </p>
        {(
          [
            ["reply", "Discussion Reply", loaderData.scenarios.replies],
            ["enrollment", "new Enrollment", loaderData.scenarios.enrollments],
          ] as const
        ).map(([intent, label, events]) => (
          <fetcher.Form
            key={intent}
            method="post"
            className="flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="intent" value={intent} />
            <label>
              {label}{" "}
              <select
                name="eventId"
                aria-label={`${label} event`}
                className="rounded border p-2"
                disabled={!events.length}
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    Event {event.id} → {event.recipientName} (user{" "}
                    {event.recipientId})
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={busy || !events.length} variant="outline">
              Replay {label}
            </Button>
            {!events.length && (
              <span>
                No eligible events for this user; select another user in DevUI.
              </span>
            )}
          </fetcher.Form>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          New Enrollment category × channel preferences
        </h2>
        <p>
          {offline
            ? "Simulator defaults: all channels off. These are NOT verified Knock defaults."
            : "Configure environment defaults in Knock first; inspect the returned preferences below rather than assuming a missing value means off."}{" "}
          Opting into email/push stores a preference only; no provider is
          provisioned here.
        </p>
        {(["in_app_feed", "email", "push"] as const).map((channel) => (
          <fetcher.Form
            key={channel}
            method="post"
            className="flex items-center gap-2"
          >
            <input type="hidden" name="intent" value="preference" />
            <input type="hidden" name="channel" value={channel} />
            <span className="w-28">{channel}</span>
            <Button
              name="enabled"
              value="true"
              disabled={busy}
              variant="outline"
            >
              Opt in {channel}
            </Button>
            <Button
              name="enabled"
              value="false"
              disabled={busy}
              variant="outline"
            >
              Opt out {channel}
            </Button>
          </fetcher.Form>
        ))}
      </section>

      <section className="space-y-3" aria-live="polite">
        <h2 className="text-lg font-semibold">Notification Feed state</h2>
        <p data-testid="report">
          {fetcher.data?.report ??
            (offline
              ? "OFFLINE: empty per-user feed until an event is replayed to this user."
              : "Click Refresh to query Knock. No live request has been made by this page loader.")}
        </p>
        {fetcher.data?.security && (
          <pre data-testid="security-results">
            {JSON.stringify(fetcher.data.security, null, 2)}
          </pre>
        )}
        {snapshot && (
          <>
            <p data-testid="feed-counts">
              Total: {snapshot.meta.total_count} | Unread:{" "}
              {snapshot.meta.unread_count} | Unseen:{" "}
              {snapshot.meta.unseen_count}
            </p>
            {snapshot.entries.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded border p-3"
              >
                <span>{item.id}</span>
                {(["seen", "read"] as const).map((intent) => (
                  <fetcher.Form key={intent} method="post">
                    <input type="hidden" name="itemId" value={item.id} />
                    <Button
                      name="intent"
                      value={intent}
                      disabled={busy}
                      variant="outline"
                    >
                      Mark {intent}
                    </Button>
                  </fetcher.Form>
                ))}
              </div>
            ))}
            <pre
              data-testid="feed-state"
              className="max-h-96 overflow-auto rounded border p-3"
            >
              {JSON.stringify(snapshot, null, 2)}
            </pre>
          </>
        )}
      </section>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <main className="space-y-3 p-6" role="alert">
      <h1 className="text-xl font-bold">
        Knock prototype could not complete the request
      </h1>
      <p>
        {isRouteErrorResponse(error)
          ? String(error.data)
          : "An unexpected error occurred. Check the local development server output; no offline fallback or vendor success was recorded."}
      </p>
      <p>The floating DevUI panel is available to select a user.</p>
      <Link to="/prototype/knock" reloadDocument className="underline">
        Reload the prototype
      </Link>
    </main>
  );
}
