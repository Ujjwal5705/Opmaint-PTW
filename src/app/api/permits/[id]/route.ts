import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, withErrorHandling } from "@/lib/apiHelpers";
import { canViewPermit } from "@/lib/permissions";
import { expireIfPastWindow } from "@/lib/permitService";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const user = await requireUser();
    const { id } = await params;

    // Check expiry before loading the full detail, so we never render a
    // permit as ACTIVE/APPROVED/SUSPENDED when its window has already passed.
    await expireIfPastWindow(id);

    const permit = await prisma.permit.findUnique({
      where: { id },
      include: {
        area: { include: { plant: true } },
        equipment: true,
        requester: { select: { id: true, name: true, email: true } },
        approvals: {
          include: {
            approver: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        },
        auditLogs: {
          include: { actor: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!permit) throw new NotFoundError("Permit not found");
    if (!canViewPermit(user, permit))
      throw new ForbiddenError("You cannot view this permit");

    return NextResponse.json({
      permit,
      currentUser: { id: user.id, role: user.role },
    });
  });
}
