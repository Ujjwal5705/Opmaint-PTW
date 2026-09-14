import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { expireIfPastWindow } from "@/lib/permitService";
import Link from "next/link";
import { redirect } from "next/navigation";
import type {
  Prisma,
  PermitStatus,
  PermitType,
} from "@/generated/prisma/client";
import {
  STATUS_LABELS,
  STATUS_STYLES,
  TYPE_LABELS,
  isExpiringSoon,
  formatCountdown,
} from "@/lib/permitDisplay";
import DashboardFilters from "./DashboardFilters";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    type?: string;
    myApprovalsPending?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;

  const scope: Prisma.PermitWhereInput =
    user.role === "ADMIN" || user.role === "SAFETY_OFFICER"
      ? {}
      : user.role === "REQUESTER"
        ? { requesterId: user.id }
        : { areaId: user.ownedAreaId ?? "__none__" };

  const filters: Prisma.PermitWhereInput = {};
  if (params.status) filters.status = params.status as PermitStatus;
  if (params.type) filters.type = params.type as PermitType;
  if (params.myApprovalsPending === "true") {
    filters.approvals = {
      some: {
        decision: "PENDING",
        role: user.role === "AREA_OWNER" ? "AREA_OWNER" : "SAFETY_OFFICER",
      },
    };
  }

  const rawPermits = await prisma.permit.findMany({
    where: { AND: [scope, filters] },
    include: {
      area: true,
      equipment: true,
      requester: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Lazy expiry, same as the API route - dashboard is a common entry point
  // where a stale ACTIVE permit would otherwise be visible.
  // We merge only status/expiredAt back onto the original (relation-laden)
  // object, rather than replacing it wholesale - expireIfPastWindow's return
  // type has no relations, so replacing the object would lose them.
  const permits = await Promise.all(
    rawPermits.map(async (p) => {
      const refreshed = await expireIfPastWindow(p.id);
      if (!refreshed) return p;
      return { ...p, status: refreshed.status, expiredAt: refreshed.expiredAt };
    }),
  );

  const activeCount = permits.filter((p) => p.status === "ACTIVE").length;
  const expiringSoon = permits.filter((p) =>
    isExpiringSoon(p.status, p.plannedEnd),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Permits</h1>
        <Link
          href="/permits/new"
          className="bg-gray-900 text-white text-sm font-medium rounded-md px-4 py-2"
        >
          + New Permit
        </Link>
      </div>

      {/* At-a-glance summary - this is the "obvious at a glance" requirement */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-2xl font-semibold text-green-700">
            {activeCount}
          </div>
          <div className="text-sm text-gray-500">Active right now</div>
        </div>
        <div
          className={`rounded-lg p-4 border ${expiringSoon.length > 0 ? "bg-red-50 border-red-200" : "bg-white border-gray-200"}`}
        >
          <div
            className={`text-2xl font-semibold ${expiringSoon.length > 0 ? "text-red-700" : "text-gray-400"}`}
          >
            {expiringSoon.length}
          </div>
          <div className="text-sm text-gray-500">Expiring in next 2 hours</div>
        </div>
      </div>

      {expiringSoon.length > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="font-medium text-red-800 mb-2 text-sm">
            ⚠ Expiring soon
          </div>
          <ul className="space-y-1">
            {expiringSoon.map((p) => (
              <li key={p.id} className="text-sm">
                <Link
                  href={`/permits/${p.id}`}
                  className="text-red-700 underline"
                >
                  {TYPE_LABELS[p.type]} — {p.workDescription}
                </Link>{" "}
                <span className="text-red-600">
                  ({formatCountdown(p.plannedEnd)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DashboardFilters
        currentStatus={params.status}
        currentType={params.type}
        currentMyApprovals={params.myApprovalsPending}
      />

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 mt-4">
        {permits.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm">
            No permits match these filters.
          </div>
        )}
        {permits.map((p) => (
          <Link
            key={p.id}
            href={`/permits/${p.id}`}
            className="flex items-center justify-between p-4 hover:bg-gray-50 transition"
          >
            <div>
              <div className="font-medium text-gray-900 text-sm">
                {p.workDescription}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {TYPE_LABELS[p.type]} · {p.area.name} · {p.equipment.name} ·{" "}
                {p.requester.name}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isExpiringSoon(p.status, p.plannedEnd) && (
                <span className="text-xs font-medium text-red-600">
                  {formatCountdown(p.plannedEnd)}
                </span>
              )}
              <span
                className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_STYLES[p.status]}`}
              >
                {STATUS_LABELS[p.status]}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
