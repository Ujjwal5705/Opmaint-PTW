"use client";

import { useRouter, useSearchParams } from "next/navigation";

const STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
  "EXPIRED",
  "REJECTED",
  "CLOSED",
  "CLOSED_VERIFIED",
  "CANCELLED",
];
const TYPES = [
  "HOT_WORK",
  "CONFINED_SPACE",
  "WORKING_AT_HEIGHT",
  "ELECTRICAL_ISOLATION",
];

export default function DashboardFilters({
  currentStatus,
  currentType,
  currentMyApprovals,
}: {
  currentStatus?: string;
  currentType?: string;
  currentMyApprovals?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/permits?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={currentStatus ?? ""}
        onChange={(e) => updateParam("status", e.target.value || null)}
        className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white"
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      <select
        value={currentType ?? ""}
        onChange={(e) => updateParam("type", e.target.value || null)}
        className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white"
      >
        <option value="">All types</option>
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={currentMyApprovals === "true"}
          onChange={(e) =>
            updateParam("myApprovalsPending", e.target.checked ? "true" : null)
          }
        />
        My approvals pending
      </label>

      {(currentStatus || currentType || currentMyApprovals) && (
        <button
          onClick={() => router.push("/permits")}
          className="text-sm text-gray-500 underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
