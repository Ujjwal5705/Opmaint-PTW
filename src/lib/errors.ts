// Thrown when a user is authenticated but not allowed to perform this action.
// API routes should catch this and return 403.
export class ForbiddenError extends Error {
  constructor(message = "You are not allowed to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

// Thrown when the requested state transition isn't valid from the permit's
// current status (or a business rule like "all approvals required" fails).
// API routes should catch this and return 409 (conflict).
export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

// Thrown when input data fails validation (e.g. typeData doesn't match schema).
// API routes should catch this and return 400.
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// Thrown when a requested record doesn't exist. API routes return 404.
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
