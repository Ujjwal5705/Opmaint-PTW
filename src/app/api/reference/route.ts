import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, withErrorHandling } from "@/lib/apiHelpers";

export async function GET() {
  return withErrorHandling(async () => {
    await requireUser(); // just needs to be logged in, no role restriction

    const plants = await prisma.plant.findMany({
      include: { areas: { include: { equipment: true } } },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ plants });
  });
}
