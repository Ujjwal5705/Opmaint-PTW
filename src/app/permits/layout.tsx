import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import LogoutButton from "./LogoutButton";

const ROLE_LABELS: Record<string, string> = {
  REQUESTER: "Requester",
  AREA_OWNER: "Area Owner",
  SAFETY_OFFICER: "Safety Officer",
  ADMIN: "Admin",
};

export default async function PermitsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/permits" className="font-semibold text-gray-900">
            Opmaint PTW
          </Link>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600 text-right">
              <div className="font-medium text-gray-900">{user.name}</div>
              <div className="text-xs">
                {ROLE_LABELS[user.role] ?? user.role}
              </div>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
