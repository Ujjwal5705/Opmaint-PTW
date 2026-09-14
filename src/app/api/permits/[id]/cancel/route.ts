import { NextResponse } from "next/server";
import { requireUser, withErrorHandling } from "@/lib/apiHelpers";
import { cancelPermit } from "@/lib/permitService";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const permit = await cancelPermit(user, id, body.comment);
    return NextResponse.json({ permit });
  });
}
