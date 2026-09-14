import { prisma } from "@/lib/prisma";
import type { User, Role } from "@/generated/prisma/client";
import { getNextStatus, type PermitAction } from "@/lib/stateMachine";
import {
  canSubmitPermit,
  canDecideApproval,
  canActivatePermit,
  canSuspendPermit,
  canResumePermit,
  canClosePermit,
  canVerifyClosure,
  canCancelPermit,
  allApprovalsGranted,
} from "@/lib/permissions";
import {
  ForbiddenError,
  InvalidTransitionError,
  ValidationError,
  NotFoundError,
} from "@/lib/errors";
import { permitTypeSchemas, type PermitTypeKey } from "@/lib/permitTypes";
import type { PermitType } from "@/generated/prisma/client";

async function getPermitOrThrow(permitId: string) {
  const permit = await prisma.permit.findUnique({
    where: { id: permitId },
    include: { approvals: true },
  });
  if (!permit) throw new NotFoundError("Permit not found");
  return permit;
}

// Writes one immutable audit log row. Called from inside every mutation below,
// always in the same Prisma transaction as the actual state change - so we
// never end up with a status change that isn't reflected in the audit trail.
async function writeAudit(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  args: {
    permitId: string;
    actorId: string;
    action: string;
    fromValue: string | null;
    toValue: string;
    comment?: string;
  },
) {
  await tx.auditLog.create({ data: args });
}

// --- Create ---

export async function createPermit(
  user: User,
  input: {
    type: PermitType;
    contractorName: string;
    workDescription: string;
    areaId: string;
    equipmentId: string;
    plannedStart: Date;
    plannedEnd: Date;
    hazards: string[];
    ppeRequired: string[];
    precautions: string[];
    typeData: unknown;
  },
) {
  const schema = permitTypeSchemas[input.type as PermitTypeKey];
  const parsed = schema.safeParse(input.typeData);
  if (!parsed.success) {
    throw new ValidationError(
      `Invalid data for permit type ${input.type}: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const permit = await tx.permit.create({
      data: {
        type: input.type,
        status: "DRAFT",
        requesterId: user.id,
        contractorName: input.contractorName,
        workDescription: input.workDescription,
        areaId: input.areaId,
        equipmentId: input.equipmentId,
        plannedStart: input.plannedStart,
        plannedEnd: input.plannedEnd,
        hazards: input.hazards,
        ppeRequired: input.ppeRequired,
        precautions: input.precautions,
        typeData: parsed.data,
      },
    });
    await writeAudit(tx, {
      permitId: permit.id,
      actorId: user.id,
      action: "CREATE",
      fromValue: null,
      toValue: "DRAFT",
    });
    return permit;
  });
}

// --- Submit (DRAFT -> PENDING_APPROVAL) ---

export async function submitPermit(user: User, permitId: string) {
  const permit = await getPermitOrThrow(permitId);

  if (!canSubmitPermit(user, permit)) throw new ForbiddenError();

  const next = getNextStatus(permit.status, "SUBMIT");
  if (!next)
    throw new InvalidTransitionError(
      `Cannot submit a permit in status ${permit.status}`,
    );

  return prisma.$transaction(async (tx) => {
    const updated = await tx.permit.update({
      where: { id: permitId },
      data: { status: next, submittedAt: new Date() },
    });

    // Create the two required approval slots. Every permit needs both,
    // regardless of type - this is what makes "all approvals granted" a
    // simple, reliable check later.
    //
    // Note on approverId: the schema requires a non-null approverId, but at
    // submission time we don't yet know WHO will approve - only which ROLE
    // slot is open. We placeholder it as the requester's own id, and
    // decideApproval() below overwrites it with the real approver's id the
    // moment someone actually acts on it. The `decision: PENDING` field is
    // what the UI and permission checks actually key off of - approverId is
    // only meaningful once decision != PENDING. Worth a one-line mention in
    // the README as a schema trade-off (a cleaner fix would make approverId
    // nullable, but that means null-checking it everywhere else).
    await tx.approval.createMany({
      data: [
        {
          permitId,
          approverId: user.id,
          role: "AREA_OWNER" as Role,
          decision: "PENDING",
        },
        {
          permitId,
          approverId: user.id,
          role: "SAFETY_OFFICER" as Role,
          decision: "PENDING",
        },
      ],
      skipDuplicates: true,
    });

    await writeAudit(tx, {
      permitId,
      actorId: user.id,
      action: "SUBMIT",
      fromValue: permit.status,
      toValue: next,
    });

    return updated;
  });
}

// --- Approve / Reject a specific role's slot ---

export async function decideApproval(
  user: User,
  permitId: string,
  approvalRole: Role,
  decision: "APPROVED" | "REJECTED",
  comment?: string,
) {
  const permit = await getPermitOrThrow(permitId);

  if (!canDecideApproval(user, permit, approvalRole))
    throw new ForbiddenError();

  if (decision === "REJECTED" && (!comment || comment.trim().length === 0)) {
    throw new InvalidTransitionError(
      "A reason is required when rejecting a permit",
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.approval.update({
      where: { permitId_role: { permitId, role: approvalRole } },
      data: { approverId: user.id, decision, comment, decidedAt: new Date() },
    });

    await writeAudit(tx, {
      permitId,
      actorId: user.id,
      action: decision === "APPROVED" ? "APPROVE" : "REJECT",
      fromValue: "PENDING",
      toValue: decision,
      comment,
    });

    if (decision === "REJECTED") {
      const next = getNextStatus(permit.status, "REJECT")!;
      const updated = await tx.permit.update({
        where: { id: permitId },
        data: { status: next },
      });
      await writeAudit(tx, {
        permitId,
        actorId: user.id,
        action: "STATUS_CHANGE",
        fromValue: permit.status,
        toValue: next,
      });
      return updated;
    }

    // Re-check all approvals including the one we just wrote.
    const freshApprovals = await tx.approval.findMany({ where: { permitId } });
    if (allApprovalsGranted(freshApprovals)) {
      const next = getNextStatus(permit.status, "APPROVE")!;
      const updated = await tx.permit.update({
        where: { id: permitId },
        data: { status: next, approvedAt: new Date() },
      });
      await writeAudit(tx, {
        permitId,
        actorId: user.id,
        action: "STATUS_CHANGE",
        fromValue: permit.status,
        toValue: next,
      });
      return updated;
    }

    // Not all approvals in yet - permit stays PENDING_APPROVAL, just return current state.
    return tx.permit.findUniqueOrThrow({ where: { id: permitId } });
  });
}

// --- Activate (APPROVED -> ACTIVE) ---

export async function activatePermit(user: User, permitId: string) {
  const permit = await getPermitOrThrow(permitId);

  if (!canActivatePermit(user, permit)) {
    if (permit.status === "APPROVED" && new Date() < permit.plannedStart) {
      throw new InvalidTransitionError(
        "Cannot activate before the planned start time",
      );
    }
    throw new ForbiddenError();
  }

  const next = getNextStatus(permit.status, "ACTIVATE");
  if (!next)
    throw new InvalidTransitionError(
      `Cannot activate a permit in status ${permit.status}`,
    );

  return prisma.$transaction(async (tx) => {
    const updated = await tx.permit.update({
      where: { id: permitId },
      data: { status: next, activatedAt: new Date() },
    });
    await writeAudit(tx, {
      permitId,
      actorId: user.id,
      action: "ACTIVATE",
      fromValue: permit.status,
      toValue: next,
    });
    return updated;
  });
}

// --- Suspend / Resume ---

export async function suspendPermit(
  user: User,
  permitId: string,
  comment: string,
) {
  const permit = await getPermitOrThrow(permitId);
  if (!canSuspendPermit(user, permit)) throw new ForbiddenError();

  const next = getNextStatus(permit.status, "SUSPEND");
  if (!next)
    throw new InvalidTransitionError(
      `Cannot suspend a permit in status ${permit.status}`,
    );

  return prisma.$transaction(async (tx) => {
    const updated = await tx.permit.update({
      where: { id: permitId },
      data: { status: next, suspendedAt: new Date() },
    });
    await writeAudit(tx, {
      permitId,
      actorId: user.id,
      action: "SUSPEND",
      fromValue: permit.status,
      toValue: next,
      comment,
    });
    return updated;
  });
}

export async function resumePermit(
  user: User,
  permitId: string,
  comment?: string,
) {
  const permit = await getPermitOrThrow(permitId);
  if (!canResumePermit(user, permit)) throw new ForbiddenError();

  const next = getNextStatus(permit.status, "RESUME");
  if (!next)
    throw new InvalidTransitionError(
      `Cannot resume a permit in status ${permit.status}`,
    );

  return prisma.$transaction(async (tx) => {
    const updated = await tx.permit.update({
      where: { id: permitId },
      data: { status: next },
    });
    await writeAudit(tx, {
      permitId,
      actorId: user.id,
      action: "RESUME",
      fromValue: permit.status,
      toValue: next,
      comment,
    });
    return updated;
  });
}

// --- Close / Verify ---

export async function closePermit(
  user: User,
  permitId: string,
  completionNotes: string,
) {
  const permit = await getPermitOrThrow(permitId);
  if (!canClosePermit(user, permit)) throw new ForbiddenError();

  const next = getNextStatus(permit.status, "CLOSE");
  if (!next)
    throw new InvalidTransitionError(
      `Cannot close a permit in status ${permit.status}`,
    );

  return prisma.$transaction(async (tx) => {
    const updated = await tx.permit.update({
      where: { id: permitId },
      data: { status: next, closedAt: new Date(), completionNotes },
    });
    await writeAudit(tx, {
      permitId,
      actorId: user.id,
      action: "CLOSE",
      fromValue: permit.status,
      toValue: next,
      comment: completionNotes,
    });
    return updated;
  });
}

export async function verifyClosure(
  user: User,
  permitId: string,
  verificationNotes: string,
) {
  const permit = await getPermitOrThrow(permitId);
  if (!canVerifyClosure(user, permit)) throw new ForbiddenError();

  const next = getNextStatus(permit.status, "VERIFY");
  if (!next)
    throw new InvalidTransitionError(
      `Cannot verify a permit in status ${permit.status}`,
    );

  return prisma.$transaction(async (tx) => {
    const updated = await tx.permit.update({
      where: { id: permitId },
      data: { status: next, verifiedAt: new Date(), verificationNotes },
    });
    await writeAudit(tx, {
      permitId,
      actorId: user.id,
      action: "VERIFY",
      fromValue: permit.status,
      toValue: next,
      comment: verificationNotes,
    });
    return updated;
  });
}

// --- Cancel ---

export async function cancelPermit(
  user: User,
  permitId: string,
  comment?: string,
) {
  const permit = await getPermitOrThrow(permitId);
  if (!canCancelPermit(user, permit)) throw new ForbiddenError();

  const next = getNextStatus(permit.status, "CANCEL");
  if (!next)
    throw new InvalidTransitionError(
      `Cannot cancel a permit in status ${permit.status}`,
    );

  return prisma.$transaction(async (tx) => {
    const updated = await tx.permit.update({
      where: { id: permitId },
      data: { status: next, cancelledAt: new Date() },
    });
    await writeAudit(tx, {
      permitId,
      actorId: user.id,
      action: "CANCEL",
      fromValue: permit.status,
      toValue: next,
      comment,
    });
    return updated;
  });
}

// --- Lazy expiry check ---
// No cron job in this build (see README). Instead, whenever a permit is read
// (list or detail), we check if its window has passed and flip it to EXPIRED
// on the way out. This is called from the GET routes, not here directly.
export async function expireIfPastWindow(permitId: string) {
  const permit = await prisma.permit.findUnique({ where: { id: permitId } });
  if (!permit) return null;

  const expirableStatuses: string[] = ["APPROVED", "ACTIVE", "SUSPENDED"];
  if (!expirableStatuses.includes(permit.status)) return permit;
  if (new Date() < permit.plannedEnd) return permit;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.permit.update({
      where: { id: permitId },
      data: { status: "EXPIRED", expiredAt: new Date() },
    });
    await writeAudit(tx, {
      permitId,
      actorId: permit.requesterId,
      action: "AUTO_EXPIRE",
      fromValue: permit.status,
      toValue: "EXPIRED",
      comment: "System: validity window passed",
    });
    return updated;
  });
}
