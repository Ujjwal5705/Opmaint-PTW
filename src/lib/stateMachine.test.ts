import { describe, it, expect } from "vitest";
import {
  getNextStatus,
  canTransition,
  isTerminal,
  TERMINAL_STATUSES,
} from "@/lib/stateMachine";
import type { PermitStatus } from "@/generated/prisma/client";

describe("state machine - happy path transitions", () => {
  it("DRAFT --submit--> PENDING_APPROVAL", () => {
    expect(getNextStatus("DRAFT", "SUBMIT")).toBe("PENDING_APPROVAL");
  });

  it("PENDING_APPROVAL --approve--> APPROVED", () => {
    expect(getNextStatus("PENDING_APPROVAL", "APPROVE")).toBe("APPROVED");
  });

  it("PENDING_APPROVAL --reject--> REJECTED", () => {
    expect(getNextStatus("PENDING_APPROVAL", "REJECT")).toBe("REJECTED");
  });

  it("APPROVED --activate--> ACTIVE", () => {
    expect(getNextStatus("APPROVED", "ACTIVATE")).toBe("ACTIVE");
  });

  it("ACTIVE --suspend--> SUSPENDED", () => {
    expect(getNextStatus("ACTIVE", "SUSPEND")).toBe("SUSPENDED");
  });

  it("SUSPENDED --resume--> ACTIVE", () => {
    expect(getNextStatus("SUSPENDED", "RESUME")).toBe("ACTIVE");
  });

  it("ACTIVE --close--> CLOSED", () => {
    expect(getNextStatus("ACTIVE", "CLOSE")).toBe("CLOSED");
  });

  it("CLOSED --verify--> CLOSED_VERIFIED", () => {
    expect(getNextStatus("CLOSED", "VERIFY")).toBe("CLOSED_VERIFIED");
  });

  it.each<PermitStatus>(["APPROVED", "ACTIVE", "SUSPENDED"])(
    "%s --expire--> EXPIRED",
    (status) => {
      expect(getNextStatus(status, "EXPIRE")).toBe("EXPIRED");
    },
  );

  it.each<PermitStatus>([
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "ACTIVE",
    "SUSPENDED",
  ])("%s --cancel--> CANCELLED", (status) => {
    expect(getNextStatus(status, "CANCEL")).toBe("CANCELLED");
  });
});

describe("state machine - illegal transitions must be rejected", () => {
  it("cannot activate a DRAFT permit (must go through approval first)", () => {
    expect(getNextStatus("DRAFT", "ACTIVATE")).toBeNull();
  });

  it("cannot submit an already-ACTIVE permit", () => {
    expect(getNextStatus("ACTIVE", "SUBMIT")).toBeNull();
  });

  it("cannot approve a DRAFT permit (must be submitted first)", () => {
    expect(getNextStatus("DRAFT", "APPROVE")).toBeNull();
  });

  it("cannot suspend a permit that isn't ACTIVE", () => {
    expect(getNextStatus("DRAFT", "SUSPEND")).toBeNull();
    expect(getNextStatus("PENDING_APPROVAL", "SUSPEND")).toBeNull();
    expect(getNextStatus("APPROVED", "SUSPEND")).toBeNull();
  });

  it("cannot close a permit that isn't ACTIVE", () => {
    expect(getNextStatus("APPROVED", "CLOSE")).toBeNull();
    expect(getNextStatus("SUSPENDED", "CLOSE")).toBeNull();
  });

  it.each<PermitStatus>(TERMINAL_STATUSES)(
    "no action is valid from terminal state %s",
    (status) => {
      const allActions = [
        "SUBMIT",
        "APPROVE",
        "REJECT",
        "ACTIVATE",
        "SUSPEND",
        "RESUME",
        "EXPIRE",
        "CLOSE",
        "VERIFY",
        "CANCEL",
      ] as const;
      for (const action of allActions) {
        expect(getNextStatus(status, action)).toBeNull();
      }
    },
  );

  it("REJECTED is a dead end - a new permit must be raised instead", () => {
    expect(canTransition("REJECTED", "SUBMIT")).toBe(false);
  });

  it("EXPIRED can never be reactivated", () => {
    expect(canTransition("EXPIRED", "ACTIVATE")).toBe(false);
    expect(canTransition("EXPIRED", "RESUME")).toBe(false);
  });
});

describe("isTerminal", () => {
  it.each<PermitStatus>(TERMINAL_STATUSES)("%s is terminal", (status) => {
    expect(isTerminal(status)).toBe(true);
  });

  it.each<PermitStatus>([
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "ACTIVE",
    "SUSPENDED",
    "CLOSED",
  ])("%s is not terminal", (status) => {
    expect(isTerminal(status)).toBe(false);
  });
});
