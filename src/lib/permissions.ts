import type { User, Permit, Approval, Role } from "@/generated/prisma/client";
import { isTerminal } from "@/lib/stateMachine";

// The shape of data every permission check needs. We pass this explicitly
// rather than querying inside these functions, so they stay pure and testable
// with plain objects - no database, no mocking required.
export type PermitWithApprovals = Permit & { approvals: Approval[] };

// --- Creation & submission ---

export function canCreatePermit(user: User): boolean {
  return user.role === "REQUESTER" || user.role === "ADMIN";
}

export function canSubmitPermit(user: User, permit: Permit): boolean {
  if (permit.status !== "DRAFT") return false;
  if (user.role === "ADMIN") return true;
  return user.role === "REQUESTER" && permit.requesterId === user.id;
}

export function canEditDraft(user: User, permit: Permit): boolean {
  if (permit.status !== "DRAFT") return false;
  if (user.role === "ADMIN") return true;
  return user.role === "REQUESTER" && permit.requesterId === user.id;
}

// --- Approval ---

/**
 * Can this user act on the approval slot for `role`?
 * Key rule from the spec: a person can NEVER approve their own permit,
 * even if their role would otherwise allow it. Checked first, unconditionally.
 */
export function canDecideApproval(
  user: User,
  permit: Permit,
  approvalRole: Role,
): boolean {
  if (permit.requesterId === user.id) return false; // never approve your own permit
  if (permit.status !== "PENDING_APPROVAL") return false;

  if (approvalRole === "SAFETY_OFFICER") {
    return user.role === "SAFETY_OFFICER" || user.role === "ADMIN";
  }

  if (approvalRole === "AREA_OWNER") {
    if (user.role === "ADMIN") return true;
    if (user.role !== "AREA_OWNER") return false;
    return user.ownedAreaId === permit.areaId; // area owners only approve their own area
  }

  return false;
}

export function allApprovalsGranted(approvals: Approval[]): boolean {
  return (
    approvals.length > 0 && approvals.every((a) => a.decision === "APPROVED")
  );
}

export function anyApprovalRejected(approvals: Approval[]): boolean {
  return approvals.some((a) => a.decision === "REJECTED");
}

// --- Activation ---

export function canActivatePermit(user: User, permit: Permit): boolean {
  if (permit.status !== "APPROVED") return false;
  if (new Date() < permit.plannedStart) return false; // cannot activate before planned start
  if (user.role === "ADMIN") return true;
  return user.role === "REQUESTER" && permit.requesterId === user.id;
}

// --- Suspend / resume ---

export function canSuspendPermit(user: User, permit: Permit): boolean {
  if (permit.status !== "ACTIVE") return false;
  return user.role === "SAFETY_OFFICER" || user.role === "ADMIN";
}

export function canResumePermit(user: User, permit: Permit): boolean {
  if (permit.status !== "SUSPENDED") return false;
  return user.role === "SAFETY_OFFICER" || user.role === "ADMIN";
}

// --- Closure ---

export function canClosePermit(user: User, permit: Permit): boolean {
  if (permit.status !== "ACTIVE") return false;
  if (user.role === "ADMIN") return true;
  return user.role === "REQUESTER" && permit.requesterId === user.id;
}

export function canVerifyClosure(user: User, permit: Permit): boolean {
  if (permit.status !== "CLOSED") return false;
  return user.role === "SAFETY_OFFICER" || user.role === "ADMIN";
}

// --- Cancellation ---

export function canCancelPermit(user: User, permit: Permit): boolean {
  if (isTerminal(permit.status)) return false;
  if (user.role === "ADMIN") return true;
  return user.role === "REQUESTER" && permit.requesterId === user.id;
}

// --- Visibility (for the dashboard / list screen) ---

export function canViewPermit(user: User, permit: Permit): boolean {
  if (user.role === "ADMIN" || user.role === "SAFETY_OFFICER") return true;
  if (user.role === "REQUESTER") return permit.requesterId === user.id;
  if (user.role === "AREA_OWNER") return user.ownedAreaId === permit.areaId;
  return false;
}
