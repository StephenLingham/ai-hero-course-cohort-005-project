import { describe, expect, it } from "vitest";
import { UserRole } from "~/db/schema";
import { USER_ROLE_LABELS } from "./utils";

describe("user role labels", () => {
  it.each([
    [UserRole.PlatformAdmin, "Platform Admin"],
    [UserRole.Instructor, "Instructor"],
    [UserRole.Student, "Student"],
  ] as const)("labels %s as %s", (role, label) => {
    expect(USER_ROLE_LABELS[role]).toBe(label);
  });
});
