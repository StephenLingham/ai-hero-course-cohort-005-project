import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/team";
import { getCurrentUserId } from "~/lib/session";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Users, BookOpen, Copy, Check, AlertTriangle } from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import { db } from "~/db";
import {
  teams,
  teamMembers,
  seats,
  courses,
  users,
  TeamMemberRole,
  RefundRequestStatus,
} from "~/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getSeatAvailability,
  listTeamLicences,
  type SeatAvailability,
} from "~/lib/refunds.server";
import { formatPrice } from "~/lib/utils";

function getTeamForAdmin(userId: number) {
  const membership = db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.TeamAdmin)
      )
    )
    .get();

  if (!membership) return undefined;

  return db.select().from(teams).where(eq(teams.id, membership.teamId)).get();
}

function getSeatsForTeam(teamId: number) {
  return db.select().from(seats).where(eq(seats.teamId, teamId)).all();
}

function getCourseById(id: number) {
  return db.select().from(courses).where(eq(courses.id, id)).get();
}

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

interface CourseStats {
  courseId: number;
  courseTitle: string;
  courseSlug: string;
  totalSeats: number;
  claimedSeats: number;
}

interface SeatRow {
  id: number;
  code: string;
  courseId: number;
  courseTitle: string;
  claimedByEmail: string | null;
  availability: SeatAvailability;
  createdAt: string;
}

export function meta() {
  return [
    { title: "Team — Cadence" },
    { name: "description", content: "Manage your team's course seats" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const team = getTeamForAdmin(currentUserId);

  if (!team) {
    throw data("You don't have a team. Purchase team seats to create one.", {
      status: 403,
    });
  }

  const allSeats = getSeatsForTeam(team.id);

  // Build per-course stats
  const courseMap = new Map<
    number,
    {
      courseId: number;
      courseTitle: string;
      courseSlug: string;
      total: number;
      claimed: number;
    }
  >();

  for (const seat of allSeats) {
    // A refunded Team Licence's Unclaimed Seats can never be claimed, so
    // they no longer count towards the team's seats.
    if (seat.refundApprovedAt !== null) continue;
    if (!courseMap.has(seat.courseId)) {
      const course = getCourseById(seat.courseId);
      courseMap.set(seat.courseId, {
        courseId: seat.courseId,
        courseTitle: course?.title ?? "Unknown Course",
        courseSlug: course?.slug ?? "",
        total: 0,
        claimed: 0,
      });
    }
    const entry = courseMap.get(seat.courseId)!;
    entry.total++;
    if (seat.claimedByUserId !== null) {
      entry.claimed++;
    }
  }

  const courseStats: CourseStats[] = Array.from(courseMap.values()).map(
    (e) => ({
      courseId: e.courseId,
      courseTitle: e.courseTitle,
      courseSlug: e.courseSlug,
      totalSeats: e.total,
      claimedSeats: e.claimed,
    })
  );

  // Build seat rows with the claiming learner's email.
  const seatRows: SeatRow[] = allSeats.map((seat) => {
    let claimedByEmail: string | null = null;
    if (seat.claimedByUserId !== null) {
      const user = getUserById(seat.claimedByUserId);
      claimedByEmail = user?.email ?? null;
    }
    const course = getCourseById(seat.courseId);
    return {
      id: seat.id,
      code: seat.code,
      courseId: seat.courseId,
      courseTitle: course?.title ?? "Unknown Course",
      claimedByEmail,
      availability: getSeatAvailability(db, seat),
      createdAt: seat.createdAt,
    };
  });

  const teamLicences = listTeamLicences(db, currentUserId, new Date());

  return { courseStats, seatRows, teamLicences };
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const url = `${window.location.origin}/redeem/${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
      title="Copy seat claim link"
    >
      {copied ? (
        <>
          <Check className="size-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3" />
          Copy link
        </>
      )}
    </button>
  );
}

export default function Team({ loaderData }: Route.ComponentProps) {
  const { courseStats, seatRows, teamLicences } = loaderData;
  const [courseFilter, setCourseFilter] = useState<number | "all">("all");

  const filteredSeats =
    courseFilter === "all"
      ? seatRows
      : seatRows.filter((c) => c.courseId === courseFilter);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Team</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Team Management</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your team&apos;s course seats and share seat claim links
        </p>
      </div>

      {/* Per-course stats */}
      {courseStats.length > 0 && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courseStats.map((stat) => (
            <Card key={stat.courseId}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="size-4 text-muted-foreground" />
                  <h3 className="font-semibold truncate">{stat.courseTitle}</h3>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold">
                      {stat.claimedSeats}
                      <span className="text-base font-normal text-muted-foreground">
                        {" "}
                        / {stat.totalSeats}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      seats claimed
                    </p>
                  </div>
                  <Link to={`/courses/${stat.courseSlug}/purchase?mode=team`}>
                    <Button variant="outline" size="sm">
                      Buy more seats
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {teamLicences.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">Team Licences</h2>
          <div className="space-y-3">
            {teamLicences.map((licence) => (
              <TeamLicenceRow key={licence.purchaseId} licence={licence} />
            ))}
          </div>
        </div>
      )}

      {/* Seat list */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Seats</h2>
          {courseStats.length > 1 && (
            <select
              value={courseFilter}
              onChange={(e) =>
                setCourseFilter(
                  e.target.value === "all" ? "all" : Number(e.target.value)
                )
              }
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="all">All courses</option>
              {courseStats.map((stat) => (
                <option key={stat.courseId} value={stat.courseId}>
                  {stat.courseTitle}
                </option>
              ))}
            </select>
          )}
        </div>

        {filteredSeats.length === 0 ? (
          <p className="text-sm text-muted-foreground">No seats yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Seat</th>
                  <th className="px-4 py-3 text-left font-medium">Course</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSeats.map((seat) => (
                  <tr key={seat.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-2 py-0.5 text-xs">
                        {seat.code}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {seat.courseTitle}
                    </td>
                    <td className="px-4 py-3">
                      {seat.claimedByEmail ? (
                        <span className="text-muted-foreground">
                          Claimed by {seat.claimedByEmail}
                        </span>
                      ) : seat.availability === "refund_approved" ? (
                        <span className="text-muted-foreground">
                          Unavailable - refund request approved
                        </span>
                      ) : seat.availability === "on_hold" ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          On hold
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Unclaimed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {seat.availability === "available" && (
                        <CopyButton code={seat.code} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

type TeamLicence = Route.ComponentProps["loaderData"]["teamLicences"][number];

function TeamLicenceRow({ licence }: { licence: TeamLicence }) {
  const fetcher = useFetcher<{ errors?: Record<string, string> }>();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const isSubmitting = fetcher.state !== "idle";
  const refundRequest = licence.latestRefundRequest;

  useEffect(() => {
    const firstError = Object.values(fetcher.data?.errors ?? {})[0];
    if (fetcher.state === "idle" && firstError) {
      toast.error(firstError);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">{licence.courseTitle}</p>
            <p className="text-sm text-muted-foreground">
              {licence.seatCount} seats · {licence.claimedSeatCount} claimed ·{" "}
              {formatPrice(licence.amountPaid)} · bought{" "}
              {new Date(licence.purchasedAt).toLocaleDateString()}
            </p>
          </div>
          {refundRequest?.status === RefundRequestStatus.Open && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              Refund request open — seats on hold
            </span>
          )}
          {refundRequest?.status === RefundRequestStatus.Approved && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              Refund request approved
            </span>
          )}
          {licence.canRequestRefund && !isFormOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setIsFormOpen(true)}
            >
              Request a refund
            </Button>
          )}
        </div>

        {refundRequest?.status === RefundRequestStatus.Declined && refundRequest.decisionNote && (
          <p className="mt-3 rounded-md bg-muted p-2 text-sm">
            <span className="font-medium">Refund request declined: </span>
            {refundRequest.decisionNote}
          </p>
        )}

        {licence.canRequestRefund && isFormOpen && (
          <fetcher.Form
            method="post"
            action={`/courses/${licence.courseSlug}/refund`}
            className="mt-4 space-y-2"
          >
            <p className="text-xs text-muted-foreground">
              Ask for {formatPrice(licence.amountPaid)} back. A Platform Admin
              will approve or decline your refund request. While it is open,
              none of this licence&apos;s seats can be claimed. You can ask until{" "}
              {/* A calendar day, so read it as local midnight, not UTC. */}
              {new Date(`${licence.lastDayInWindow}T00:00`).toLocaleDateString()}.
            </p>
            <input type="hidden" name="purchaseId" value={licence.purchaseId} />
            <Textarea
              name="reason"
              rows={3}
              required
              placeholder="What went wrong?"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Request a refund"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsFormOpen(false)}
              >
                Keep it
              </Button>
            </div>
          </fetcher.Form>
        )}
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "No team found";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have a team yet.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
