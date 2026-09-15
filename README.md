# Opmaint — Permit to Work (PTW) Module

A Permit to Work module for a CMMS, built as a take-home assignment for the Opmaint Web Development Intern role.

**Live demo:** [PASTE YOUR VERCEL URL HERE]
**Repo:** [PASTE YOUR GITHUB URL HERE]

## Demo Credentials

All seeded users share the password `password123`.

| Role           | Email                   | Notes                                                   |
| -------------- | ----------------------- | ------------------------------------------------------- |
| Requester      | `requester@opmaint.com` | Creates and submits permits                             |
| Area Owner     | `owner@opmaint.com`     | Owns **Process Unit A** only                            |
| Area Owner     | `owner2@opmaint.com`    | Owns **Tank Farm** only                                 |
| Area Owner     | `owner3@opmaint.com`    | Owns **Utilities** only                                 |
| Safety Officer | `safety@opmaint.com`    | Can approve/suspend/verify any permit                   |
| Admin          | `admin@opmaint.com`     | Full access, but still cannot approve their own permits |

The seed script also creates 2 plants, 6 pieces of equipment, and 10 permits spread across every status (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `ACTIVE`, `SUSPENDED`, `EXPIRED`, `REJECTED`, `CLOSED`, `CLOSED_VERIFIED`, `CANCELLED`) and all four permit types.

## Setup (tested on a clean machine)

Requires Node 18+ and a Postgres database (we used [Neon](https://neon.tech)'s free tier).

```bash
git clone <repo-url>
cd opmaint-ptw
npm install

# Create .env with:
# DATABASE_URL="postgresql://<your-connection-string>?sslmode=require"
# JWT_SECRET="<any long random string, e.g. output of `openssl rand -base64 32`>"

npx prisma generate
npx prisma migrate deploy   # applies the committed migration to your database
npx tsx prisma/seed.ts      # populates 4+ users, 2 plants, 6 equipment, 10 permits

npm run dev
# → http://localhost:3000
```

To reset to a clean seeded state at any point:

```bash
npx prisma migrate reset    # drops & recreates all tables, prompts for confirmation
npx tsx prisma/seed.ts      # Prisma 7 no longer auto-runs the seed after reset — run it explicitly
```

### Running tests

```bash
npx vitest run       # 56 unit tests: state machine (37) + permission rules (19)
bash verify.sh        # 21 end-to-end checks against a running dev server (localhost:3000),
                       # exercising illegal transitions, self-approval blocking, area
                       # restriction, and the full lifecycle through the real HTTP API
```

## Tech Stack

- **Next.js 16 (App Router) + TypeScript** — single codebase, deploys straight to Vercel
- **Prisma 7 + Postgres (Neon)** — real schema, real migrations (`prisma/migrations/`)
- **Zod** — validates the type-specific `typeData` payload per permit type
- **Custom JWT-in-httpOnly-cookie auth** — no OAuth, per the brief's guidance not to burn hours on it
- **Vitest** — unit tests for the state machine and permission rules
- **Tailwind CSS** — styling

## The Core Design Decision: One Permit Entity, Not Four Forms

The brief's biggest ask was: _"a junior developer builds four separate forms with copy-pasted code... show us you can model a shared permit entity with type-specific fields, so a fifth permit type can be added without rewriting anything."_

Here's how that's implemented:

- **One `Permit` table** (see `prisma/schema.prisma`) holds every field every permit type shares: requester, location (area → equipment), timing, hazards, PPE, precautions, status, and all lifecycle timestamps.
- **One `typeData Json` column** holds only the fields specific to whichever type the permit is — gas readings for Hot Work, atmospheric tests for Confined Space, isolation points for LOTO, etc.
- **A Zod schema per permit type**, registered in a single lookup object in `src/lib/permitTypes.ts`:

  ```typescript
  export const permitTypeSchemas = {
    HOT_WORK: hotWorkSchema,
    CONFINED_SPACE: confinedSpaceSchema,
    WORKING_AT_HEIGHT: workingAtHeightSchema,
    ELECTRICAL_ISOLATION: electricalIsolationSchema,
  } as const;
  ```

**Adding a fifth type (e.g. Excavation) means:** write one new Zod schema, add one line to that registry object, and add one `if (type === "EXCAVATION")` branch to the create-permit wizard's type-specific field renderer. No migration, no changes to the state machine, permissions, service layer, API routes, dashboard, or audit trail — all of that code only ever touches the shared fields plus a generic `Record<string, unknown>` for the type-specific ones.

## State Machine

Implemented as data, not scattered `if` statements — see `src/lib/stateMachine.ts`. The transition table is a direct, line-by-line translation of the diagram in the brief:

```typescript
const transitions = {
  DRAFT: { SUBMIT: "PENDING_APPROVAL", CANCEL: "CANCELLED" },
  PENDING_APPROVAL: {
    APPROVE: "APPROVED",
    REJECT: "REJECTED",
    CANCEL: "CANCELLED",
  },
  APPROVED: { ACTIVATE: "ACTIVE", EXPIRE: "EXPIRED", CANCEL: "CANCELLED" },
  ACTIVE: {
    SUSPEND: "SUSPENDED",
    EXPIRE: "EXPIRED",
    CLOSE: "CLOSED",
    CANCEL: "CANCELLED",
  },
  SUSPENDED: { RESUME: "ACTIVE", EXPIRE: "EXPIRED", CANCEL: "CANCELLED" },
  CLOSED: { VERIFY: "CLOSED_VERIFIED" },
  // REJECTED, EXPIRED, CANCELLED, CLOSED_VERIFIED are absent = terminal
};
```

All rules from the spec are enforced **server-side**, in `src/lib/permitService.ts` and `src/lib/permissions.ts`, not just hidden in the UI:

- A permit cannot go `ACTIVE` unless every required approver has approved (`allApprovalsGranted` re-checks all `Approval` rows before flipping to `APPROVED`, which gates `ACTIVE`).
- A permit cannot be activated before its `plannedStart` (checked in `canActivatePermit`).
- Expired permits can never be reactivated (`EXPIRE` only ever leads to the terminal `EXPIRED` state; there is no transition back out of it).
- Illegal transitions are rejected with a clear error and correct HTTP status, even hitting the API directly — see `verify.sh` for 21 automated checks of exactly this, including via `curl` with no browser involved.

## Roles & Permissions

Enforced in `src/lib/permissions.ts` as pure functions (no database access), which makes them fully unit-testable with plain objects — see `src/lib/permissions.test.ts`.

The two rules the brief calls out by name are both explicitly tested:

1. **A person can never approve their own permit** — checked first, unconditionally, before any role or area check (`canDecideApproval`).
2. **Area owners only approve permits in their own area** — enforced by comparing `user.ownedAreaId` to `permit.areaId`.

The permit detail page computes these flags server-side and passes only plain booleans to the client — so a user genuinely never sees a button they aren't allowed to press, rather than the button being present but silently failing.

## Audit Trail

Every mutation in `permitService.ts` writes to `AuditLog` inside the same Prisma `$transaction` as the actual state change, so the audit trail can never drift out of sync with reality. It's rendered on the permit detail page as a readable timeline (who did what, when, with their comment), not a JSON dump.

## Decisions Made Where the Spec Was Silent

- **`typeData` as JSON, validated by Zod at the application layer** rather than one table per permit type — this is the decision the whole assignment is built around; see above.
- **Auth: custom JWT in an httpOnly cookie**, not NextAuth. With four custom roles and rules like "can't approve your own permit" and "area owners only for their area," a hand-rolled ~40-line auth module was faster to build, fully defensible line-by-line, and avoided fighting a library's abstractions for something this specific.
- **Expiry is lazy, not cron-based.** Every list/detail fetch calls `expireIfPastWindow()`, which flips any `ACTIVE`/`APPROVED`/`SUSPENDED` permit whose `plannedEnd` has passed into `EXPIRED`, inside a transaction with its own audit log entry. This satisfies "expiry handling that actually works... even when nobody has the browser open" without standing up real cron infrastructure, which felt like over-engineering for a week-long assignment. The trade-off: a permit won't flip to `EXPIRED` until _someone_ next loads a page that touches it — acceptable for this scope, explicitly not "true" background expiry.
- **`Approval.approverId` is non-nullable in the schema**, but at submission time we don't yet know who will approve — only which role slot is open. We placeholder it with the submitter's own ID and overwrite it with the real approver's ID the moment someone acts on the slot. `decision: PENDING` is the field everything actually keys off; `approverId` is only meaningful once `decision != PENDING`. A cleaner schema would make this field nullable — documented here rather than hidden.
- **`canClosePermit` only allows closing from `ACTIVE`**, not `SUSPENDED`, matching the diagram exactly (which routes `SUSPENDED` back through `RESUME → ACTIVE` before it can be closed). This was a deliberate, literal reading of the state diagram rather than an oversight.
- **Hazards / PPE / Precautions as Postgres `String[]`** (native arrays) rather than separate join tables — simpler for this scope, since they're just checklist tags, not entities with their own attributes.

## What I'd Build Next

- **Precise error codes:** a few actions (e.g. activating a `DRAFT` permit) return `403 Forbidden` when `409 Conflict` would be more semantically correct — the permission check and the state check are currently combined in one function and the permission check fires first. Splitting "wrong permission" from "wrong state" into separate, ordered checks would make API error messages more specific.
- **Extension request flow** (requester asks for +N hours, re-approved by safety officer, capped and logged) — the schema already has `extensionHours`/`extensionCapHours` fields reserved for this, but the request/approval flow itself isn't built.
- **Conflict detection** — warning when a new Hot Work permit overlaps in time and location with an existing Confined Space permit. Genuinely useful and explicitly called out in the brief as something "almost nobody's software does," but didn't fit in the time available.
- **A real-time countdown** on the "expiring soon" badges (currently computed at render/page-load time, not live-updating without a refresh).
- **Notification stub** — the brief accepts a stub function that just logs "would notify X"; I didn't wire this in given time constraints, though it would be a quick addition to `permitService.ts`.
- QR code per permit and canvas-based digital signature capture — both explicitly listed as bonus items in the brief; not attempted given the time budget.
- A dedicated mobile-first layout pass — the app is responsive by default (Tailwind), but I didn't specifically design for "technician holding a phone with gloves on, outdoors" the way the brief describes.

## What I Knowingly Left Broken / Incomplete

- The `step2Valid()` check in the create-permit wizard's frontend doesn't verify that Electrical Isolation's `isolationPoints`/`lockNumbers`/`tagNumbers` arrays are non-empty before letting you proceed to review — the **server-side** Zod schema does enforce this and will correctly reject an incomplete submission with a clear error, but the UI won't catch it until then. A minor UX gap, not a correctness gap.
- No automated tests for the API routes themselves (only the pure `stateMachine`/`permissions` logic has Vitest unit tests) — `verify.sh` covers this gap with real HTTP-level checks against a running server instead, but it's a shell script, not part of the `vitest` suite.
- Cookie-based session has an 8-hour expiry with no refresh mechanism — a user mid-shift on a long permit could get logged out and have to log back in.

## On AI Use

This project was built collaboratively with Claude (Anthropic), used for:

- Architecture discussion and design trade-offs (e.g. the `typeData` JSON approach, lazy vs. cron-based expiry, JWT vs. NextAuth)
- Writing the initial implementation of most files, reviewed and corrected in an interactive loop
- Debugging real issues encountered along the way — most notably several breaking changes in Prisma 7 (the new client generator's output location, the removal of `datasourceUrl` in favor of required driver adapters, and the removal of automatic seed-running after `migrate reset`) that aren't yet well-documented and had to be diagnosed from actual error output rather than assumed
- Writing the `verify.sh` end-to-end verification script and this README

I can walk through and explain every line of this codebase, including why specific decisions were made, in the Loom video.
