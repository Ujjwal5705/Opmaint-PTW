import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  ForbiddenError,
  InvalidTransitionError,
  ValidationError,
  NotFoundError,
} from "@/lib/errors";
import type { User } from "@/generated/prisma/client";

// Every protected route calls this first. Throws a plain Error (mapped to 401
// by the wrapper below) if there's no valid session - so routes never need to
// remember to check "is user null" themselves.
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    const err = new Error("Not authenticated");
    err.name = "UnauthenticatedError";
    throw err;
  }
  return user;
}

// Wraps a route handler so every custom error class from errors.ts maps to
// the right HTTP status automatically. This is the ONE place that decision
// lives - individual routes just throw and don't think about status codes.
export function withErrorHandling(
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  return handler().catch((err: unknown) => {
    if (err instanceof Error) {
      if (err.name === "UnauthenticatedError") {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      if (err instanceof ForbiddenError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      if (err instanceof NotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      if (
        err instanceof InvalidTransitionError ||
        err instanceof ValidationError
      ) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      console.error(err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
    console.error(err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  });
}
