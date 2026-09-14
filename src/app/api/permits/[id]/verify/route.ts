import { NextResponse } from "next/server";
import { requireUser, withErrorHandling } from "@/lib/apiHelpers";
import { verifyClosure } from "@/lib/permitService";
import { ValidationError } from "@/lib/errors";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    if (!body.verificationNotes || body.verificationNotes.trim().length === 0) {
      throw new ValidationError(
        "Verification notes are required to verify closure",
      );
    }

    const permit = await verifyClosure(user, id, body.verificationNotes);
    return NextResponse.json({ permit });
  });
}
