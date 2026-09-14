import "dotenv/config";
import {
  PrismaClient,
  Role,
  PermitType,
  PermitStatus,
  ApprovalDecision,
} from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding...");

  const password = await bcrypt.hash("password123", 10);

  // --- Plants & Areas ---
  const plantA = await prisma.plant.create({
    data: { name: "Chennai Plant 1" },
  });
  const plantB = await prisma.plant.create({
    data: { name: "Chennai Plant 2" },
  });

  const areaUtilities = await prisma.area.create({
    data: { name: "Utilities", plantId: plantA.id },
  });
  const areaProcess = await prisma.area.create({
    data: { name: "Process Unit A", plantId: plantA.id },
  });
  const areaTankFarm = await prisma.area.create({
    data: { name: "Tank Farm", plantId: plantB.id },
  });

  // --- Equipment ---
  const eq1 = await prisma.equipment.create({
    data: { tag: "PMP-101", name: "Feed Pump 101", areaId: areaProcess.id },
  });
  const eq2 = await prisma.equipment.create({
    data: { tag: "TNK-204", name: "Storage Tank 204", areaId: areaTankFarm.id },
  });
  const eq3 = await prisma.equipment.create({
    data: { tag: "PNL-11", name: "MCC Panel 11", areaId: areaUtilities.id },
  });
  const eq4 = await prisma.equipment.create({
    data: { tag: "PIPE-RACK-3", name: "Pipe Rack 3", areaId: areaProcess.id },
  });
  const eq5 = await prisma.equipment.create({
    data: { tag: "VSL-77", name: "Reactor Vessel 77", areaId: areaTankFarm.id },
  });
  const eq6 = await prisma.equipment.create({
    data: {
      tag: "LADR-ACC-2",
      name: "Ladder Access Point 2",
      areaId: areaUtilities.id,
    },
  });

  // --- Users (one per role, plus one extra area owner for a second area) ---
  const admin = await prisma.user.create({
    data: {
      name: "Admin User",
      email: "admin@opmaint.com",
      passwordHash: password,
      role: Role.ADMIN,
    },
  });
  const safetyOfficer = await prisma.user.create({
    data: {
      name: "Priya Safety",
      email: "safety@opmaint.com",
      passwordHash: password,
      role: Role.SAFETY_OFFICER,
    },
  });
  const requester = await prisma.user.create({
    data: {
      name: "Arun Contractor",
      email: "requester@opmaint.com",
      passwordHash: password,
      role: Role.REQUESTER,
    },
  });
  const areaOwner = await prisma.user.create({
    data: {
      name: "Karthik Owner",
      email: "owner@opmaint.com",
      passwordHash: password,
      role: Role.AREA_OWNER,
      ownedAreaId: areaProcess.id,
    },
  });
  const areaOwner2 = await prisma.user.create({
    data: {
      name: "Meena Owner",
      email: "owner2@opmaint.com",
      passwordHash: password,
      role: Role.AREA_OWNER,
      ownedAreaId: areaTankFarm.id,
    },
  });

  console.log("Users, plants, areas, equipment created.");
  console.log({
    admin: admin.email,
    safetyOfficer: safetyOfficer.email,
    requester: requester.email,
    areaOwner: areaOwner.email,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
