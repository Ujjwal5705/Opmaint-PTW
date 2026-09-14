import { PermitStatus } from "@/generated/prisma/client";

// Every action a permit can go through. Keeping this as a union type (not raw
// strings scattered everywhere) means TypeScript catches typos at compile time.
export type PermitAction =
  | "SUBMIT"
  | "APPROVE"
  | "REJECT"
  | "ACTIVATE"
  | "SUSPEND"
  | "RESUME"
  | "EXPIRE"
  | "CLOSE"
  | "VERIFY"
  | "CANCEL";

// The transition table IS the state machine from the spec, written as data.
// Reading this table top to bottom should map 1:1 onto the diagram in the brief.
const transitions: Partial<
  Record<PermitStatus, Partial<Record<PermitAction, PermitStatus>>>
> = {
  DRAFT: {
    SUBMIT: "PENDING_APPROVAL",
    CANCEL: "CANCELLED",
  },
  PENDING_APPROVAL: {
    APPROVE: "APPROVED", // only valid once ALL approvals are in - guarded in permitService, not here
    REJECT: "REJECTED",
    CANCEL: "CANCELLED",
  },
  APPROVED: {
    ACTIVATE: "ACTIVE", // guarded: must be at/after plannedStart
    EXPIRE: "EXPIRED", // e.g. approved but never activated before window passed
    CANCEL: "CANCELLED",
  },
  ACTIVE: {
    SUSPEND: "SUSPENDED",
    EXPIRE: "EXPIRED",
    CLOSE: "CLOSED",
    CANCEL: "CANCELLED",
  },
  SUSPENDED: {
    RESUME: "ACTIVE",
    EXPIRE: "EXPIRED",
    CANCEL: "CANCELLED",
  },
  CLOSED: {
    VERIFY: "CLOSED_VERIFIED",
  },
  // Terminal states - intentionally absent from this table, so any action
  // against them falls through to "no transition found" below.
  // REJECTED, EXPIRED, CANCELLED, CLOSED_VERIFIED
};

export const TERMINAL_STATUSES: PermitStatus[] = [
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "CLOSED_VERIFIED",
];

export function isTerminal(status: PermitStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Pure function: given a current status and an attempted action, returns the
 * resulting status, or null if that transition is not allowed.
 * This function has NO side effects and NO database access - that's what
 * makes it trivial to unit test exhaustively.
 */
export function getNextStatus(
  current: PermitStatus,
  action: PermitAction,
): PermitStatus | null {
  const allowedFromCurrent = transitions[current];
  if (!allowedFromCurrent) return null; // current status is terminal or unknown
  return allowedFromCurrent[action] ?? null;
}

export function canTransition(
  current: PermitStatus,
  action: PermitAction,
): boolean {
  return getNextStatus(current, action) !== null;
}
