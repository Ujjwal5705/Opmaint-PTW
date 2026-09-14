import type { PermitStatus, PermitType } from "@/generated/prisma/client";

export const STATUS_LABELS: Record<PermitStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  EXPIRED: "Expired",
  REJECTED: "Rejected",
  CLOSED: "Closed",
  CLOSED_VERIFIED: "Closed & Verified",
  CANCELLED: "Cancelled",
};

export const TYPE_LABELS: Record<PermitType, string> = {
  HOT_WORK: "Hot Work",
  CONFINED_SPACE: "Confined Space Entry",
  WORKING_AT_HEIGHT: "Working at Height",
  ELECTRICAL_ISOLATION: "Electrical / Isolation (LOTO)",
};

// Tailwind classes per status - used consistently across dashboard, detail, everywhere.
export const STATUS_STYLES: Record<PermitStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  ACTIVE: "bg-green-100 text-green-800",
  SUSPENDED: "bg-orange-100 text-orange-800",
  EXPIRED: "bg-gray-200 text-gray-600",
  REJECTED: "bg-red-100 text-red-800",
  CLOSED: "bg-purple-100 text-purple-800",
  CLOSED_VERIFIED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-gray-200 text-gray-500",
};

const EXPIRING_SOON_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours, per the spec

export function isExpiringSoon(
  status: PermitStatus,
  plannedEnd: Date,
): boolean {
  if (status !== "ACTIVE") return false;
  const msRemaining = new Date(plannedEnd).getTime() - Date.now();
  return msRemaining > 0 && msRemaining <= EXPIRING_SOON_WINDOW_MS;
}

export function formatCountdown(plannedEnd: Date): string {
  const msRemaining = new Date(plannedEnd).getTime() - Date.now();
  if (msRemaining <= 0) return "Expired";
  const totalMinutes = Math.floor(msRemaining / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}
