import { NextResponse } from "next/server";
import { requireUser, withErrorHandling } from "@/lib/apiHelpers";
import { decideApproval } from "@/lib/permitService";
import { ValidationError } from "@/lib/errors";
import type { Role } from "@/generated/prisma/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json().catch(() => null);

    if (!body || !["AREA_OWNER", "SAFETY_OFFICER"].includes(body.role)) {
      throw new ValidationError(
        "Body must include role: 'AREA_OWNER' | 'SAFETY_OFFICER'",
      );
    }
    if (!["APPROVED", "REJECTED"].includes(body.decision)) {
      throw new ValidationError(
        "Body must include decision: 'APPROVED' | 'REJECTED'",
      );
    }

    const permit = await decideApproval(
      user,
      id,
      body.role as Role,
      body.decision as "APPROVED" | "REJECTED",
      body.comment,
    );
    return NextResponse.json({ permit });
  });
}
