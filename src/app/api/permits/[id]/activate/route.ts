import { NextResponse } from "next/server";
import { requireUser, withErrorHandling } from "@/lib/apiHelpers";
import { activatePermit } from "@/lib/permitService";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const user = await requireUser();
    const { id } = await params;
    const permit = await activatePermit(user, id);
    return NextResponse.json({ permit });
  });
}
