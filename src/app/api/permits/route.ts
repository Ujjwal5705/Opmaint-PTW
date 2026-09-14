import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, withErrorHandling } from "@/lib/apiHelpers";
import { canCreatePermit } from "@/lib/permissions";
import { createPermit, expireIfPastWindow } from "@/lib/permitService";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type {
  Prisma,
  PermitStatus,
  PermitType,
} from "@/generated/prisma/client";

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await requireUser();
    const params = req.nextUrl.searchParams;

    // Role-based visibility scope, matching permissions.ts:canViewPermit,
    // expressed as a Prisma where-clause so filtering happens in the DB,
    // not by fetching everything and filtering in memory.
    const scope: Prisma.PermitWhereInput =
      user.role === "ADMIN" || user.role === "SAFETY_OFFICER"
        ? {}
        : user.role === "REQUESTER"
          ? { requesterId: user.id }
          : { areaId: user.ownedAreaId ?? "__none__" }; // AREA_OWNER

    const filters: Prisma.PermitWhereInput = {};
    const status = params.get("status");
    const type = params.get("type");
    const areaId = params.get("areaId");
    const from = params.get("from");
    const to = params.get("to");
    const myApprovalsPending = params.get("myApprovalsPending");

    if (status) filters.status = status as PermitStatus;
    if (type) filters.type = type as PermitType;
    if (areaId) filters.areaId = areaId;
    if (from || to) {
      filters.plannedStart = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    // "My approvals pending" - permits where THIS user has an open approval slot.
    if (myApprovalsPending === "true") {
      filters.approvals = {
        some: {
          decision: "PENDING",
          role: user.role === "AREA_OWNER" ? "AREA_OWNER" : "SAFETY_OFFICER",
        },
      };
      if (user.role === "AREA_OWNER") {
        filters.areaId = user.ownedAreaId ?? "__none__";
      }
    }

    const permits = await prisma.permit.findMany({
      where: { AND: [scope, filters] },
      include: {
        area: { include: { plant: true } },
        equipment: true,
        requester: { select: { id: true, name: true, email: true } },
        approvals: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    // Lazily expire anything whose window has passed, on the way out, so the
    // dashboard never shows a stale ACTIVE/APPROVED/SUSPENDED permit as if it
    // were still valid. See permitService.ts for why this is lazy, not cron.
    const withExpiryChecked = await Promise.all(
      permits.map(async (p) => {
        const refreshed = await expireIfPastWindow(p.id);
        return refreshed ?? p;
      }),
    );

    return NextResponse.json({ permits: withExpiryChecked });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await requireUser();
    if (!canCreatePermit(user))
      throw new ForbiddenError("Only requesters or admins can create permits");

    const body = await req.json().catch(() => null);
    if (!body) throw new ValidationError("Invalid JSON body");

    const required = [
      "type",
      "contractorName",
      "workDescription",
      "areaId",
      "equipmentId",
      "plannedStart",
      "plannedEnd",
      "typeData",
    ];
    for (const field of required) {
      if (body[field] === undefined || body[field] === null) {
        throw new ValidationError(`Missing required field: ${field}`);
      }
    }

    const permit = await createPermit(user, {
      type: body.type,
      contractorName: body.contractorName,
      workDescription: body.workDescription,
      areaId: body.areaId,
      equipmentId: body.equipmentId,
      plannedStart: new Date(body.plannedStart),
      plannedEnd: new Date(body.plannedEnd),
      hazards: body.hazards ?? [],
      ppeRequired: body.ppeRequired ?? [],
      precautions: body.precautions ?? [],
      typeData: body.typeData,
    });

    return NextResponse.json({ permit }, { status: 201 });
  });
}
