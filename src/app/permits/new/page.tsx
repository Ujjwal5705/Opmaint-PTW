import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreatePermit } from "@/lib/permissions";
import NewPermitWizard from "./NewPermitWizard";

export default async function NewPermitPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canCreatePermit(user)) {
    return (
      <div className="bg-white border border-red-200 rounded-lg p-6 text-center text-red-600 text-sm">
        Only requesters or admins can create permits.
      </div>
    );
  }

  const plants = await prisma.plant.findMany({
    include: { areas: { include: { equipment: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">
        New Permit to Work
      </h1>
      <NewPermitWizard plants={plants} />
    </div>
  );
}
