import { Link, useFetcher, redirect } from "react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/redeem.$code";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import { parseParams, parseFormData } from "~/lib/validation";
import { getSeatAvailability } from "~/lib/refunds.server";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Ticket, AlertCircle, CheckCircle2, Globe } from "lucide-react";
import { data } from "react-router";
import { db } from "~/db";
import { purchases, seats, courses, enrollments } from "~/db/schema";
import { eq, and } from "drizzle-orm";

function getCourseById(id: number) {
  return db.select().from(courses).where(eq(courses.id, id)).get();
}

function getSeatByCode(code: string) {
  return db.select().from(seats).where(eq(seats.code, code)).get();
}

function isUserEnrolled(userId: number, courseId: number) {
  const existing = db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();

  return !!existing;
}

const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
const SEAT_REFUND_APPROVED =
  "This seat is no longer available. Ask the person who shared it with you.";

type ClaimSeatResult =
  | { ok: true; enrollment: typeof enrollments.$inferSelect }
  | { ok: false; error: string };

function claimSeat(
  code: string,
  userId: number,
  userCountry: string
): ClaimSeatResult {
  const seat = getSeatByCode(code);
  if (!seat) {
    return { ok: false, error: "Seat not found" };
  }

  if (seat.claimedByUserId !== null) {
    return { ok: false, error: "Seat has already been claimed" };
  }

  const availability = getSeatAvailability(db, seat);
  if (availability === "on_hold") {
    return { ok: false, error: SEAT_ON_HOLD };
  }
  if (availability === "refund_approved") {
    return { ok: false, error: SEAT_REFUND_APPROVED };
  }

  const existingEnrollment = db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, seat.courseId)
      )
    )
    .get();

  if (existingEnrollment) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, seat.purchaseId))
    .get();

  if (purchase?.country && purchase.country !== userCountry) {
    return {
      ok: false,
      error:
        "This seat can only be claimed from the same country as the Team Admin who bought the licence",
    };
  }

  db.update(seats)
    .set({
      claimedByUserId: userId,
      claimedAt: new Date().toISOString(),
    })
    .where(eq(seats.id, seat.id))
    .run();

  const enrollment = db
    .insert(enrollments)
    .values({ userId, courseId: seat.courseId })
    .returning()
    .get();

  return { ok: true, enrollment };
}

const claimSeatParamsSchema = z.object({
  code: z.string().min(1),
});

const claimSeatActionSchema = z.object({
  intent: z.literal("confirm-redeem"),
});

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Claim Seat";
  return [
    { title: `Claim Seat: ${title} — Cadence` },
    { name: "description", content: `Claim your seat for ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { code } = parseParams(params, claimSeatParamsSchema);

  const seat = getSeatByCode(code);
  if (!seat) {
    throw data("Seat not found.", { status: 404 });
  }

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw redirect(
      `/login?redirectTo=${encodeURIComponent(`/redeem/${code}`)}`
    );
  }

  const course = getCourseById(seat.courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  const alreadyClaimed = seat.claimedByUserId !== null;
  const alreadyEnrolled = isUserEnrolled(currentUserId, seat.courseId);
  const availability = getSeatAvailability(db, seat);
  const unavailableReason =
    availability === "on_hold"
      ? SEAT_ON_HOLD
      : availability === "refund_approved"
        ? SEAT_REFUND_APPROVED
        : null;

  // Check country mismatch upfront so we can show a clear message
  let countryMismatch = false;
  if (!alreadyClaimed && !alreadyEnrolled) {
    const userCountry = await resolveCountry(request);
    const purchase = db
      .select()
      .from(purchases)
      .where(eq(purchases.id, seat.purchaseId))
      .get();
    if (purchase?.country && purchase.country !== (userCountry ?? "")) {
      countryMismatch = true;
    }
  }

  return {
    course: { id: course.id, title: course.title, slug: course.slug },
    code,
    alreadyClaimed,
    alreadyEnrolled,
    countryMismatch,
    unavailableReason,
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const { code } = parseParams(params, claimSeatParamsSchema);

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, claimSeatActionSchema);

  if (!parsed.success) {
    throw data("Invalid action.", { status: 400 });
  }

  const userCountry = await resolveCountry(request);
  const result = claimSeat(code, currentUserId, userCountry ?? "");

  if (!result.ok) {
    return data({ error: result.error }, { status: 400 });
  }

  const course = getCourseById(result.enrollment.courseId);
  if (!course) {
    throw redirect("/courses");
  }

  throw redirect(`/courses/${course.slug}/welcome`);
}

export default function ClaimSeat({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    course,
    code,
    alreadyClaimed,
    alreadyEnrolled,
    countryMismatch,
    unavailableReason,
  } = loaderData;
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    const error =
      fetcher.data?.error ?? (actionData as { error?: string })?.error;
    if (error) {
      toast.error(error);
    }
  }, [fetcher.data, actionData]);

  // Determine which state to show
  const canClaim =
    !alreadyClaimed && !alreadyEnrolled && !countryMismatch && !unavailableReason;

  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <h1 className="mb-2 text-2xl font-bold">Claim Seat</h1>
      <p className="mb-8 text-muted-foreground">
        You&apos;ve been invited to enroll in a course.
      </p>

      <Card>
        <CardContent className="p-8 text-center">
          <div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Ticket className="size-8 text-primary" />
          </div>

          <h2 className="mb-2 text-xl font-semibold">{course.title}</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Seat:{" "}
            <code className="rounded bg-muted px-2 py-0.5">{code}</code>
          </p>

          {alreadyClaimed ? (
            <div className="rounded-lg bg-destructive/10 p-4">
              <div className="flex items-center justify-center gap-2 text-destructive">
                <AlertCircle className="size-5" />
                <span className="font-medium">
                  This seat has already been claimed
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Someone has already claimed this seat. Please ask the person who
                shared this link for another seat.
              </p>
            </div>
          ) : alreadyEnrolled ? (
            <div className="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
              <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="size-5" />
                <span className="font-medium">
                  You&apos;re already enrolled
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                You already have access to this course. The seat is still
                unclaimed, so its link can be shared with someone else.
              </p>
              <Link to={`/courses/${course.slug}`}>
                <Button className="mt-4" size="lg">
                  Go to Course
                </Button>
              </Link>
            </div>
          ) : unavailableReason ? (
            <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-900/20">
              <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400">
                <AlertCircle className="size-5" />
                <span className="font-medium">Seat unavailable</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {unavailableReason}
              </p>
            </div>
          ) : countryMismatch ? (
            <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-900/20">
              <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400">
                <Globe className="size-5" />
                <span className="font-medium">Region restriction</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                This seat can only be claimed from the same country as the
                Team Admin who bought the licence. Your location doesn&apos;t
                match their country.
              </p>
            </div>
          ) : (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="confirm-redeem" />
              <Button
                size="lg"
                className="w-full max-w-sm"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Claiming..." : "Claim Seat"}
              </Button>
            </fetcher.Form>
          )}

          <div className="mt-6">
            <Link
              to={`/courses/${course.slug}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View course details
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
