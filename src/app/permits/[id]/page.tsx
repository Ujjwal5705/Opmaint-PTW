import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { expireIfPastWindow } from "@/lib/permitService";
import {
  canViewPermit,
  canSubmitPermit,
  canActivatePermit,
  canSuspendPermit,
  canResumePermit,
  canClosePermit,
  canVerifyClosure,
  canCancelPermit,
  canDecideApproval,
} from "@/lib/permissions";
import {
  STATUS_LABELS,
  STATUS_STYLES,
  TYPE_LABELS,
  formatCountdown,
  isExpiringSoon,
} from "@/lib/permitDisplay";
import PermitActions from "./PermitActions";

export default async function PermitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;

  await expireIfPastWindow(id);

  const permit = await prisma.permit.findUnique({
    where: { id },
    include: {
      area: { include: { plant: true } },
      equipment: true,
      requester: { select: { id: true, name: true, email: true } },
      approvals: {
        include: { approver: { select: { id: true, name: true, role: true } } },
      },
      auditLogs: {
        include: { actor: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!permit) notFound();
  if (!canViewPermit(user, permit)) {
    return (
      <div className="bg-white border border-red-200 rounded-lg p-6 text-center text-red-600 text-sm">
        You don&apos;t have permission to view this permit.
      </div>
    );
  }

  const typeData = permit.typeData as Record<string, unknown>;

  // Computed server-side, where importing permissions.ts is safe (it never
  // ends up in the client bundle this way). PermitActions below receives
  // only plain booleans/strings - no permission logic ships to the browser.
  const actionFlags = {
    canSubmit: canSubmitPermit(user, permit),
    canActivate: canActivatePermit(user, permit),
    canSuspend: canSuspendPermit(user, permit),
    canResume: canResumePermit(user, permit),
    canClose: canClosePermit(user, permit),
    canVerify: canVerifyClosure(user, permit),
    canCancel: canCancelPermit(user, permit),
  };

  const approvalFlags = permit.approvals.map((a) => ({
    id: a.id,
    role: a.role,
    decision: a.decision,
    canDecide:
      a.decision === "PENDING" && canDecideApproval(user, permit, a.role),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-gray-500 mb-1">
            {TYPE_LABELS[permit.type]}
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            {permit.workDescription}
          </h1>
          <div className="text-sm text-gray-500 mt-1">
            {permit.area.plant.name} → {permit.area.name} →{" "}
            {permit.equipment.name}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`text-xs font-medium px-3 py-1.5 rounded-full ${STATUS_STYLES[permit.status]}`}
          >
            {STATUS_LABELS[permit.status]}
          </span>
          {isExpiringSoon(permit.status, permit.plannedEnd) && (
            <span className="text-xs font-medium text-red-600">
              {formatCountdown(permit.plannedEnd)}
            </span>
          )}
        </div>
      </div>

      <PermitActions
        permitId={permit.id}
        status={permit.status}
        actions={actionFlags}
        approvals={approvalFlags}
      />

      {/* Core details */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">
          Core Details
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label="Requester" value={permit.requester.name} />
          <Field label="Contractor / Team" value={permit.contractorName} />
          <Field
            label="Planned Start"
            value={new Date(permit.plannedStart).toLocaleString()}
          />
          <Field
            label="Planned End"
            value={new Date(permit.plannedEnd).toLocaleString()}
          />
          <Field label="Hazards" value={permit.hazards.join(", ") || "—"} />
          <Field
            label="PPE Required"
            value={permit.ppeRequired.join(", ") || "—"}
          />
          <Field
            label="Precautions"
            value={permit.precautions.join(", ") || "—"}
          />
        </dl>
      </section>

      {/* Type-specific details */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">
          {TYPE_LABELS[permit.type]} Details
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {Object.entries(typeData).map(([key, value]) => (
            <Field
              key={key}
              label={humanizeKey(key)}
              value={
                typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value)
              }
            />
          ))}
        </dl>
      </section>

      {/* Approvals */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Approvals</h2>
        <div className="space-y-2">
          {permit.approvals.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between text-sm border-b border-gray-50 pb-2 last:border-0"
            >
              <div>
                <span className="font-medium text-gray-800">
                  {a.role.replace("_", " ")}
                </span>
                {a.decision !== "PENDING" && (
                  <span className="text-gray-500"> — {a.approver.name}</span>
                )}
                {a.comment && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    &ldquo;{a.comment}&rdquo;
                  </div>
                )}
              </div>
              <span
                className={`text-xs font-medium px-2 py-1 rounded-full ${
                  a.decision === "APPROVED"
                    ? "bg-green-100 text-green-800"
                    : a.decision === "REJECTED"
                      ? "bg-red-100 text-red-800"
                      : "bg-gray-100 text-gray-600"
                }`}
              >
                {a.decision}
              </span>
            </div>
          ))}
          {permit.approvals.length === 0 && (
            <p className="text-sm text-gray-400">
              No approvals required yet (permit not submitted).
            </p>
          )}
        </div>
      </section>

      {/* Closure notes, if any */}
      {(permit.completionNotes || permit.verificationNotes) && (
        <section className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Closure</h2>
          {permit.completionNotes && (
            <Field label="Completion Notes" value={permit.completionNotes} />
          )}
          {permit.verificationNotes && (
            <Field
              label="Verification Notes"
              value={permit.verificationNotes}
            />
          )}
        </section>
      )}

      {/* Audit trail - readable timeline, not a JSON dump, per the spec */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">
          Audit Trail
        </h2>
        <ol className="space-y-3">
          {permit.auditLogs.map((log) => (
            <li
              key={log.id}
              className="text-sm border-l-2 border-gray-200 pl-3"
            >
              <div className="text-gray-800">
                <span className="font-medium">{log.actor.name}</span>{" "}
                <span className="text-gray-500">
                  {describeAction(log.action, log.fromValue, log.toValue)}
                </span>
              </div>
              {log.comment && (
                <div className="text-xs text-gray-500 mt-0.5">
                  &ldquo;{log.comment}&rdquo;
                </div>
              )}
              <div className="text-xs text-gray-400 mt-0.5">
                {new Date(log.createdAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-gray-800">{value}</dd>
    </div>
  );
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function describeAction(
  action: string,
  from: string | null,
  to: string | null,
): string {
  switch (action) {
    case "CREATE":
      return "created the permit as DRAFT";
    case "SUBMIT":
      return `submitted for approval (${from} → ${to})`;
    case "APPROVE":
      return "approved their assigned slot";
    case "REJECT":
      return "rejected their assigned slot";
    case "STATUS_CHANGE":
      return `status changed: ${from} → ${to}`;
    case "ACTIVATE":
      return `activated the permit (${from} → ${to})`;
    case "SUSPEND":
      return `suspended the permit (${from} → ${to})`;
    case "RESUME":
      return `resumed the permit (${from} → ${to})`;
    case "CLOSE":
      return `closed the permit (${from} → ${to})`;
    case "VERIFY":
      return `verified closure (${from} → ${to})`;
    case "CANCEL":
      return `cancelled the permit (${from} → ${to})`;
    case "AUTO_EXPIRE":
      return `permit auto-expired (${from} → ${to})`;
    default:
      return `${action}: ${from} → ${to}`;
  }
}
