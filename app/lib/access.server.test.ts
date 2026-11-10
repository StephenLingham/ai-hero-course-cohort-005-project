import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { data } from "react-router";
import { db } from "~/db";
import { teamMembers, teams, users, TeamMemberRole, UserRole } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { seedBaseData } from "~/test/setup";
import { requirePlatformAdmin } from "./access.server";

vi.mock("~/db", async () => {
  const { createTestDb } = await import("~/test/setup");
  return { db: createTestDb() };
});

vi.mock("~/lib/session", () => ({
  getCurrentUserId: vi.fn(),
}));

let learner: typeof users.$inferSelect;
let instructor: typeof users.$inferSelect;
let platformAdmin: typeof users.$inferSelect;
let teamAdmin: typeof users.$inferSelect;

beforeAll(() => {
  const base = seedBaseData(db);
  learner = base.user;
  instructor = base.instructor;
  platformAdmin = db
    .insert(users)
    .values({
      name: "Platform Admin",
      email: "platform-admin@example.com",
      role: UserRole.PlatformAdmin,
    })
    .returning()
    .get();
  teamAdmin = db
    .insert(users)
    .values({
      name: "Team Admin",
      email: "team-admin@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();
  const team = db.insert(teams).values({}).returning().get();
  db.insert(teamMembers)
    .values({
      teamId: team.id,
      userId: teamAdmin.id,
      role: TeamMemberRole.TeamAdmin,
    })
    .run();
});

beforeEach(() => {
  vi.mocked(getCurrentUserId).mockReset();
  vi.mocked(getCurrentUserId).mockResolvedValue(null);
});

const request = new Request("http://localhost/admin/refunds");

describe("Platform Admin access to Refund Requests", () => {
  it("requires a signed-in user", async () => {
    await expect(requirePlatformAdmin(request)).rejects.toEqual(
      data("Select a user from the DevUI panel.", { status: 401 })
    );
  });

  it("rejects a session whose user does not exist", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(-1);

    await expect(requirePlatformAdmin(request)).rejects.toEqual(
      data("Only Platform Admins can access this page.", { status: 403 })
    );
  });

  it("allows a Platform Admin", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(platformAdmin.id);

    await expect(requirePlatformAdmin(request)).resolves.toEqual(platformAdmin);
  });

  it.each(["learner", "instructor", "teamAdmin"] as const)(
    "does not give a %s authority to decide Refund Requests",
    async (role) => {
      const actors = { learner, instructor, teamAdmin };
      vi.mocked(getCurrentUserId).mockResolvedValue(actors[role].id);

      await expect(requirePlatformAdmin(request)).rejects.toEqual(
        data("Only Platform Admins can access this page.", { status: 403 })
      );
    }
  );
});
