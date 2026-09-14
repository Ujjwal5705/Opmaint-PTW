import { NextResponse } from "next/server";
import { requireUser, withErrorHandling } from "@/lib/apiHelpers";
import { suspendPermit } from "@/lib/permitService";
import { ValidationError } from "@/lib/errors";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    if (!body.comment || body.comment.trim().length === 0) {
      throw new ValidationError("A reason is required to suspend a permit");
    }

    const permit = await suspendPermit(user, id, body.comment);
    return NextResponse.json({ permit });
  });
}
