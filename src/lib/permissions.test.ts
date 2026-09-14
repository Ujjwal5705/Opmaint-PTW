import { describe, it, expect } from "vitest";
import {
  canDecideApproval,
  canActivatePermit,
  canSuspendPermit,
  canCancelPermit,
  canViewPermit,
} from "@/lib/permissions";
import type { User, Permit } from "@/generated/prisma/client";

// Minimal fake builders - we only need the fields permissions.ts actually reads.
// This is the payoff of keeping permissions.ts pure: no database, no mocking.
function fakeUser(overrides: Partial<User>): User {
  return {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    passwordHash: "x",
    role: "REQUESTER",
    ownedAreaId: null,
    createdAt: new Date(),
    ...overrides,
  } as User;
}

function fakePermit(overrides: Partial<Permit>): Permit {
  return {
    id: "permit-1",
    type: "HOT_WORK",
    status: "PENDING_APPROVAL",
    requesterId: "requester-1",
    contractorName: "Acme Co",
    workDescription: "Test job",
    areaId: "area-1",
    equipmentId: "eq-1",
    plannedStart: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
    plannedEnd: new Date(Date.now() + 1000 * 60 * 60 * 4),
    hazards: [],
    ppeRequired: [],
    precautions: [],
    typeData: {},
    submittedAt: new Date(),
    approvedAt: null,
    activatedAt: null,
    suspendedAt: null,
    expiredAt: null,
    closedAt: null,
    verifiedAt: null,
    cancelledAt: null,
    completionNotes: null,
    verificationNotes: null,
    extensionHours: 0,
    extensionCapHours: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Permit;
}

describe("canDecideApproval - a person can never approve their own permit", () => {
  it("blocks the requester from approving their own permit as SAFETY_OFFICER", () => {
    const user = fakeUser({ id: "u1", role: "SAFETY_OFFICER" });
    const permit = fakePermit({ requesterId: "u1" }); // same person requested it
    expect(canDecideApproval(user, permit, "SAFETY_OFFICER")).toBe(false);
  });

  it("blocks the requester from approving their own permit as AREA_OWNER, even if they own the area", () => {
    const user = fakeUser({
      id: "u1",
      role: "AREA_OWNER",
      ownedAreaId: "area-1",
    });
    const permit = fakePermit({ requesterId: "u1", areaId: "area-1" });
    expect(canDecideApproval(user, permit, "AREA_OWNER")).toBe(false);
  });

  it("blocks even an ADMIN from approving their own permit", () => {
    const user = fakeUser({ id: "u1", role: "ADMIN" });
    const permit = fakePermit({ requesterId: "u1" });
    expect(canDecideApproval(user, permit, "SAFETY_OFFICER")).toBe(false);
  });

  it("allows a different safety officer to approve", () => {
    const user = fakeUser({ id: "safety-1", role: "SAFETY_OFFICER" });
    const permit = fakePermit({ requesterId: "requester-1" });
    expect(canDecideApproval(user, permit, "SAFETY_OFFICER")).toBe(true);
  });
});

describe("canDecideApproval - area owners only approve their own area", () => {
  it("allows an area owner to approve a permit in their own area", () => {
    const user = fakeUser({
      id: "owner-1",
      role: "AREA_OWNER",
      ownedAreaId: "area-A",
    });
    const permit = fakePermit({ requesterId: "requester-1", areaId: "area-A" });
    expect(canDecideApproval(user, permit, "AREA_OWNER")).toBe(true);
  });

  it("blocks an area owner from approving a permit in a DIFFERENT area", () => {
    const user = fakeUser({
      id: "owner-1",
      role: "AREA_OWNER",
      ownedAreaId: "area-A",
    });
    const permit = fakePermit({ requesterId: "requester-1", areaId: "area-B" });
    expect(canDecideApproval(user, permit, "AREA_OWNER")).toBe(false);
  });

  it("blocks a REQUESTER role from approving anything, regardless of area", () => {
    const user = fakeUser({ id: "req-2", role: "REQUESTER" });
    const permit = fakePermit({ requesterId: "requester-1", areaId: "area-A" });
    expect(canDecideApproval(user, permit, "AREA_OWNER")).toBe(false);
  });

  it("blocks deciding an approval on a permit that isn't PENDING_APPROVAL", () => {
    const user = fakeUser({ id: "safety-1", role: "SAFETY_OFFICER" });
    const permit = fakePermit({ requesterId: "requester-1", status: "DRAFT" });
    expect(canDecideApproval(user, permit, "SAFETY_OFFICER")).toBe(false);
  });
});

describe("canActivatePermit - cannot activate before planned start time", () => {
  it("blocks activation when plannedStart is in the future", () => {
    const user = fakeUser({ id: "requester-1", role: "REQUESTER" });
    const permit = fakePermit({
      requesterId: "requester-1",
      status: "APPROVED",
      plannedStart: new Date(Date.now() + 1000 * 60 * 60), // 1 hour from now
    });
    expect(canActivatePermit(user, permit)).toBe(false);
  });

  it("allows activation once plannedStart has passed", () => {
    const user = fakeUser({ id: "requester-1", role: "REQUESTER" });
    const permit = fakePermit({
      requesterId: "requester-1",
      status: "APPROVED",
      plannedStart: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
    });
    expect(canActivatePermit(user, permit)).toBe(true);
  });

  it("blocks activation if the permit isn't in APPROVED status", () => {
    const user = fakeUser({ id: "requester-1", role: "REQUESTER" });
    const permit = fakePermit({ requesterId: "requester-1", status: "DRAFT" });
    expect(canActivatePermit(user, permit)).toBe(false);
  });
});

describe("canSuspendPermit - only safety officer or admin, only on ACTIVE permits", () => {
  it("allows a safety officer to suspend an active permit", () => {
    const user = fakeUser({ role: "SAFETY_OFFICER" });
    const permit = fakePermit({ status: "ACTIVE" });
    expect(canSuspendPermit(user, permit)).toBe(true);
  });

  it("blocks a requester from suspending, even their own permit", () => {
    const user = fakeUser({ id: "requester-1", role: "REQUESTER" });
    const permit = fakePermit({ requesterId: "requester-1", status: "ACTIVE" });
    expect(canSuspendPermit(user, permit)).toBe(false);
  });

  it("blocks an area owner from suspending", () => {
    const user = fakeUser({ role: "AREA_OWNER" });
    const permit = fakePermit({ status: "ACTIVE" });
    expect(canSuspendPermit(user, permit)).toBe(false);
  });
});

describe("canCancelPermit - cannot cancel a terminal permit", () => {
  it("blocks cancelling an already-CLOSED_VERIFIED permit", () => {
    const user = fakeUser({ id: "requester-1", role: "REQUESTER" });
    const permit = fakePermit({
      requesterId: "requester-1",
      status: "CLOSED_VERIFIED",
    });
    expect(canCancelPermit(user, permit)).toBe(false);
  });

  it("allows the requester to cancel their own DRAFT permit", () => {
    const user = fakeUser({ id: "requester-1", role: "REQUESTER" });
    const permit = fakePermit({ requesterId: "requester-1", status: "DRAFT" });
    expect(canCancelPermit(user, permit)).toBe(true);
  });
});

describe("canViewPermit - visibility rules per role", () => {
  it("a requester can see their own permit but not someone else's", () => {
    const user = fakeUser({ id: "requester-1", role: "REQUESTER" });
    const own = fakePermit({ requesterId: "requester-1" });
    const someoneElses = fakePermit({ requesterId: "requester-2" });
    expect(canViewPermit(user, own)).toBe(true);
    expect(canViewPermit(user, someoneElses)).toBe(false);
  });

  it("an area owner can see permits in their area but not other areas", () => {
    const user = fakeUser({ role: "AREA_OWNER", ownedAreaId: "area-A" });
    const inArea = fakePermit({ areaId: "area-A" });
    const outsideArea = fakePermit({ areaId: "area-B" });
    expect(canViewPermit(user, inArea)).toBe(true);
    expect(canViewPermit(user, outsideArea)).toBe(false);
  });

  it("safety officers and admins can see everything", () => {
    const safety = fakeUser({ role: "SAFETY_OFFICER" });
    const admin = fakeUser({ role: "ADMIN" });
    const permit = fakePermit({ requesterId: "anyone", areaId: "any-area" });
    expect(canViewPermit(safety, permit)).toBe(true);
    expect(canViewPermit(admin, permit)).toBe(true);
  });
});
