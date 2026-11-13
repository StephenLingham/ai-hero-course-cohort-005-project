import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  verify,
} from "node:crypto";
import Knock from "@knocklabs/node";
import { signUserToken } from "@knocklabs/node/lib/tokenSigner";
import { and, eq, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { data } from "react-router";
import { z } from "zod";
import { db } from "~/db";
import {
  comments,
  courses,
  enrollments,
  lessons,
  modules,
  users,
} from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";

// Throwaway vendor-fit harness. No production event hooks or database writes.
const channels = ["in_app_feed", "email", "push"] as const;
const enrollmentCategory = "prototype-enrollment";
const feedSchema = z.object({
  entries: z.array(
    z
      .object({
        id: z.string(),
        read_at: z.string().nullable().optional(),
        seen_at: z.string().nullable().optional(),
      })
      .passthrough()
  ),
  meta: z.object({
    total_count: z.number(),
    unread_count: z.number(),
    unseen_count: z.number(),
  }),
  page_info: z.unknown(),
});
type Feed = z.infer<typeof feedSchema>;
type Channel = (typeof channels)[number];
type OfflineState = {
  entries: Feed["entries"];
  preferences: Record<Channel, boolean>;
};
export type PrototypeSnapshot = Feed & { preferences: unknown };
const offlineUsers = new Map<number, OfflineState>();
let offlineSigningKey: string | undefined;

const commandSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("inspect") }),
  z.object({ intent: z.literal("security") }),
  z.object({
    intent: z.enum(["reply", "enrollment"]),
    eventId: z.coerce.number().int().positive(),
  }),
  z.object({ intent: z.enum(["read", "seen"]), itemId: z.string().min(1) }),
  z.object({
    intent: z.literal("preference"),
    channel: z.enum(channels),
    enabled: z.enum(["true", "false"]),
  }),
]);

function stateFor(userId: number) {
  let state = offlineUsers.get(userId);
  if (!state) {
    state = {
      entries: [],
      preferences: { in_app_feed: false, email: false, push: false },
    };
    offlineUsers.set(userId, state);
  }
  return state;
}

function vendorUserId(userId: number) {
  return `cadence-prototype-user-${userId}`;
}

function required(name: string) {
  const value = process.env[name];
  if (!value)
    throw data(
      `Live prototype requires ${name}. No offline fallback was used.`,
      { status: 503 }
    );
  return value;
}

export async function prototypeContext(request: Request) {
  if (
    !import.meta.env.DEV ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)
  ) {
    throw data(
      "This throwaway prototype is available on localhost in development only.",
      { status: 404 }
    );
  }
  const userId = await getCurrentUserId(request);
  const user = userId
    ? db.select().from(users).where(eq(users.id, userId)).get()
    : undefined;
  if (!user) throw data("Select a user from the DevUI panel.", { status: 401 });

  const parsedMode = z
    .enum(["offline", "live"])
    .safeParse(process.env.KNOCK_PROTOTYPE_MODE ?? "offline");
  if (!parsedMode.success)
    throw data("KNOCK_PROTOTYPE_MODE must be offline or live.", {
      status: 503,
    });
  const mode = parsedMode.data;
  let signingKey: string;
  let live: { publicKey: string; secretKey: string; feedId: string } | null =
    null;
  if (mode === "live") {
    if (required("KNOCK_ENVIRONMENT") !== "development") {
      throw data("The live prototype requires KNOCK_ENVIRONMENT=development.", {
        status: 503,
      });
    }
    live = {
      publicKey: required("KNOCK_PUBLIC_API_KEY"),
      secretKey: required("KNOCK_SECRET_API_KEY"),
      feedId: required("KNOCK_FEED_CHANNEL_ID"),
    };
    if (
      !live.publicKey.startsWith("pk_") ||
      !live.secretKey.startsWith("sk_")
    ) {
      throw data("Expected Knock public (pk_) and secret (sk_) API keys.", {
        status: 503,
      });
    }
    signingKey = required("KNOCK_SIGNING_KEY");
  } else {
    offlineSigningKey ??= generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    signingKey = offlineSigningKey;
  }
  const privateKey = createPrivateKey(
    signingKey.includes("-----BEGIN")
      ? signingKey
      : Buffer.from(signingKey, "base64")
  );
  if (
    privateKey.asymmetricKeyType !== "rsa" ||
    (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  ) {
    throw data(
      "The prototype requires an RSA signing key of at least 2048 bits.",
      { status: 503 }
    );
  }
  const subject = vendorUserId(user.id);
  const token = await signUserToken(subject, {
    signingKey,
    expiresInSeconds: 900,
  });
  const [header, payload, signature] = token.split(".");
  const algorithm = z
    .object({ alg: z.literal("RS256") })
    .parse(JSON.parse(Buffer.from(header, "base64url").toString()));
  const claims = z
    .object({ sub: z.literal(subject), exp: z.number() })
    .parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
  const signatureVerified = verify(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    createPublicKey(privateKey),
    Buffer.from(signature, "base64url")
  );
  if (!signatureVerified)
    throw data("Local token signature verification failed.", { status: 500 });
  return {
    mode,
    user: { id: user.id, name: user.name, role: user.role },
    subject,
    token,
    live,
    tokenSummary: {
      alg: algorithm.alg,
      sub: claims.sub,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      signatureVerified,
      keySource:
        mode === "offline"
          ? "ephemeral local key, NOT registered with Knock"
          : "configured Knock signing key",
    },
  };
}
type Context = Awaited<ReturnType<typeof prototypeContext>>;

export function prototypeScenarios(userId: number) {
  const question = alias(comments, "question");
  const replies = db
    .select({
      id: comments.id,
      recipientId: question.userId,
      recipientName: users.name,
    })
    .from(comments)
    .innerJoin(question, eq(comments.parentId, question.id))
    .innerJoin(users, eq(users.id, question.userId))
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(
      and(
        eq(comments.userId, userId),
        isNull(comments.deletedAt),
        isNull(question.deletedAt),
        isNull(question.parentId),
        eq(question.lessonId, comments.lessonId),
        ne(question.userId, userId),
        ne(question.userId, courses.instructorId)
      )
    )
    .all();
  const enrollmentEvents = db
    .select({
      id: enrollments.id,
      recipientId: courses.instructorId,
      recipientName: users.name,
    })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .innerJoin(users, eq(users.id, courses.instructorId))
    .where(
      and(eq(enrollments.userId, userId), ne(courses.instructorId, userId))
    )
    .all();
  return { replies, enrollments: enrollmentEvents };
}

async function vendorRequest(
  context: Context,
  path: string,
  method = "GET",
  body?: unknown
) {
  if (!context.live)
    throw data("Vendor requests are forbidden in offline mode.", {
      status: 409,
    });
  const response = await fetch(`https://api.knock.app/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${context.live.publicKey}`,
      "X-Knock-User-Token": context.token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw data(
      `Knock ${method} ${path} failed (HTTP ${response.status}). No simulated success was substituted.`,
      { status: 502 }
    );
  }
  const result: unknown = await response.json();
  return result;
}

export async function prototypeSnapshot(
  context: Context
): Promise<PrototypeSnapshot> {
  if (context.live) {
    const [feed, preferences] = await Promise.all([
      vendorRequest(
        context,
        `/users/${context.subject}/feeds/${encodeURIComponent(context.live.feedId)}`
      ),
      vendorRequest(context, `/users/${context.subject}/preferences/default`),
    ]);
    const parsed = feedSchema.safeParse(feed);
    if (!parsed.success)
      throw data("Knock returned an unexpected feed shape.", { status: 502 });
    return { ...parsed.data, preferences };
  }
  const state = stateFor(context.user.id);
  return {
    entries: state.entries,
    meta: {
      total_count: state.entries.length,
      unread_count: state.entries.filter((item) => !item.read_at).length,
      unseen_count: state.entries.filter((item) => !item.seen_at).length,
    },
    page_info: { after: null, before: null },
    preferences: {
      id: "default",
      categories: {
        [enrollmentCategory]: { channel_types: state.preferences },
      },
    },
  };
}

export async function runPrototypeCommand(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    throw data("Prototype actions require a same-origin request.", {
      status: 403,
    });
  }
  const context = await prototypeContext(request);
  const parsed = commandSchema.safeParse(
    Object.fromEntries(await request.formData())
  );
  if (!parsed.success)
    throw data("Invalid prototype command.", { status: 400 });
  const command = parsed.data;
  let report = context.live
    ? "Read from Knock using the public key and selected user's signed token."
    : "OFFLINE simulation only; Knock was not contacted.";
  let security: {
    authenticated: number;
    missingToken: number;
    otherUser: number;
  } | null = null;

  if (command.intent === "reply" || command.intent === "enrollment") {
    const scenarios = prototypeScenarios(context.user.id);
    const scenario = (
      command.intent === "reply" ? scenarios.replies : scenarios.enrollments
    ).find((event) => event.id === command.eventId);
    if (!scenario)
      throw data(
        "That event does not belong to the selected user or is not eligible.",
        { status: 400 }
      );
    const workflow =
      command.intent === "reply"
        ? "cadence-prototype-discussion-reply"
        : "cadence-prototype-new-enrollment";
    const payload = {
      prototype: true,
      event_id: scenario.id,
      event_type: command.intent,
    };
    if (context.live) {
      const knock = new Knock({
        apiKey: context.live.secretKey,
        maxRetries: 0,
        timeout: 15_000,
      });
      const result = await knock.workflows.trigger(workflow, {
        actor: { id: context.subject },
        recipients: [{ id: vendorUserId(scenario.recipientId) }],
        data: payload,
      });
      report = `Knock accepted workflow run ${result.workflow_run_id}. This is NOT delivery proof. Switch to ${scenario.recipientName} and refresh their feed.`;
    } else {
      const recipient = stateFor(scenario.recipientId);
      if (command.intent === "reply" || recipient.preferences.in_app_feed) {
        recipient.entries.unshift({
          id: `offline-${randomUUID()}`,
          read_at: null,
          seen_at: null,
          inserted_at: new Date().toISOString(),
          data: payload,
          source: { key: workflow },
        });
        report = `OFFLINE: simulated delivery to ${scenario.recipientName} (user ${scenario.recipientId}). Switch users in DevUI to inspect it.`;
      } else {
        report = `OFFLINE: new Enrollment suppressed for ${scenario.recipientName}; the simulated in-app preference is off.`;
      }
    }
  } else if (command.intent === "read" || command.intent === "seen") {
    if (context.live) {
      await vendorRequest(
        context,
        `/messages/${encodeURIComponent(command.itemId)}/${command.intent}`,
        "PUT"
      );
    } else {
      const item = stateFor(context.user.id).entries.find(
        (entry) => entry.id === command.itemId
      );
      if (!item)
        throw data("The item is not in the selected user's offline feed.", {
          status: 404,
        });
      const now = new Date().toISOString();
      item.seen_at ??= now;
      if (command.intent === "read") item.read_at ??= now;
    }
  } else if (command.intent === "preference") {
    if (context.live) {
      await vendorRequest(
        context,
        `/users/${context.subject}/preferences/default`,
        "PUT",
        {
          __persistence_strategy__: "merge",
          categories: {
            [enrollmentCategory]: {
              channel_types: { [command.channel]: command.enabled === "true" },
            },
          },
        }
      );
    } else {
      stateFor(context.user.id).preferences[command.channel] =
        command.enabled === "true";
    }
  } else if (command.intent === "security") {
    if (!context.live)
      throw data(
        "Token isolation must be tested against Knock, not the offline simulator.",
        { status: 409 }
      );
    const other = db
      .select({ id: users.id })
      .from(users)
      .where(ne(users.id, context.user.id))
      .get();
    if (!other)
      throw data("Token isolation needs a second Cadence user.", {
        status: 409,
      });
    const { publicKey, feedId } = context.live;
    async function statusFor(userId: string, token?: string) {
      const response = await fetch(
        `https://api.knock.app/v1/users/${userId}/feeds/${encodeURIComponent(feedId)}`,
        {
          headers: {
            Authorization: `Bearer ${publicKey}`,
            ...(token ? { "X-Knock-User-Token": token } : {}),
          },
          signal: AbortSignal.timeout(15_000),
        }
      );
      await response.body?.cancel();
      return response.status;
    }
    const [authenticated, missingToken, otherUser] = await Promise.all([
      statusFor(context.subject, context.token),
      statusFor(context.subject),
      statusFor(vendorUserId(other.id), context.token),
    ]);
    security = { authenticated, missingToken, otherUser };
    report =
      "Check these actual HTTP statuses: authenticated must be 200; missing-token and cross-user requests must both be 401/403. Anything else leaves security unproven.";
  }
  return {
    userId: context.user.id,
    report,
    security,
    snapshot: await prototypeSnapshot(context),
  };
}
