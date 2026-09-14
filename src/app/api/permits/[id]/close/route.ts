import { NextResponse } from "next/server";
import { requireUser, withErrorHandling } from "@/lib/apiHelpers";
import { closePermit } from "@/lib/permitService";
import { ValidationError } from "@/lib/errors";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    if (!body.completionNotes || body.completionNotes.trim().length === 0) {
      throw new ValidationError(
        "Completion notes are required to close a permit",
      );
    }

    const permit = await closePermit(user, id, body.completionNotes);
    return NextResponse.json({ permit });
  });
}
