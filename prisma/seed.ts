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

  const areaOwner3 = await prisma.user.create({
    data: {
      name: "Rekha Owner",
      email: "owner3@opmaint.com",
      passwordHash: password,
      role: Role.AREA_OWNER,
      ownedAreaId: areaUtilities.id,
    },
  });

  const hours = (n: number) => new Date(Date.now() + n * 60 * 60 * 1000);

  async function logAudit(
    permitId: string,
    actorId: string,
    action: string,
    fromValue: string | null,
    toValue: string,
    comment?: string,
  ) {
    await prisma.auditLog.create({
      data: { permitId, actorId, action, fromValue, toValue, comment },
    });
  }

  // 1. HOT_WORK - DRAFT
  const p1 = await prisma.permit.create({
    data: {
      type: PermitType.HOT_WORK,
      status: PermitStatus.DRAFT,
      requesterId: requester.id,
      contractorName: "SVR Fabricators",
      workDescription: "Weld bracket onto feed pump support",
      areaId: areaProcess.id,
      equipmentId: eq1.id,
      plannedStart: hours(24),
      plannedEnd: hours(28),
      hazards: ["flammable vapour"],
      ppeRequired: ["fire retardant suit", "face shield"],
      precautions: ["isolate line", "fire watch present"],
      typeData: {
        hotWorkType: "welding",
        fireWatchAssigned: "Ravi Kumar",
        fireExtinguisherType: "CO2",
        combustiblesClearedRadiusMeters: 10,
        gasTest: {
          lelPercent: 0,
          o2Percent: 20.9,
          testTime: new Date().toISOString(),
        },
      },
    },
  });
  await logAudit(p1.id, requester.id, "CREATE", null, "DRAFT");

  // 2. HOT_WORK - PENDING_APPROVAL (area owner approved, safety officer still pending)
  const p2 = await prisma.permit.create({
    data: {
      type: PermitType.HOT_WORK,
      status: PermitStatus.PENDING_APPROVAL,
      requesterId: requester.id,
      contractorName: "SVR Fabricators",
      workDescription: "Cut damaged section of pipe rack support",
      areaId: areaProcess.id,
      equipmentId: eq4.id,
      plannedStart: hours(20),
      plannedEnd: hours(24),
      hazards: ["flammable vapour", "falling debris"],
      ppeRequired: ["fire retardant suit", "hard hat"],
      precautions: ["isolate line", "fire watch present", "barricade area"],
      submittedAt: hours(-2),
      typeData: {
        hotWorkType: "cutting",
        fireWatchAssigned: "Ravi Kumar",
        fireExtinguisherType: "DCP",
        combustiblesClearedRadiusMeters: 10,
        gasTest: {
          lelPercent: 0,
          o2Percent: 20.9,
          testTime: new Date().toISOString(),
        },
      },
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p2.id,
      approverId: areaOwner.id,
      role: Role.AREA_OWNER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-1),
      comment: "Looks fine, proceed",
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p2.id,
      approverId: safetyOfficer.id,
      role: Role.SAFETY_OFFICER,
      decision: ApprovalDecision.PENDING,
    },
  });
  await logAudit(p2.id, requester.id, "SUBMIT", "DRAFT", "PENDING_APPROVAL");
  await logAudit(
    p2.id,
    areaOwner.id,
    "APPROVE",
    "PENDING",
    "APPROVED",
    "Looks fine, proceed",
  );

  // 3. CONFINED_SPACE - APPROVED (both approved, not yet activated - start time in future)
  const p3 = await prisma.permit.create({
    data: {
      type: PermitType.CONFINED_SPACE,
      status: PermitStatus.APPROVED,
      requesterId: requester.id,
      contractorName: "Deep Clean Services",
      workDescription: "Internal inspection and cleaning of storage tank",
      areaId: areaTankFarm.id,
      equipmentId: eq2.id,
      plannedStart: hours(6),
      plannedEnd: hours(14),
      hazards: ["oxygen deficiency", "toxic gas"],
      ppeRequired: ["SCBA", "harness"],
      precautions: ["continuous ventilation", "standby attendant present"],
      submittedAt: hours(-6),
      approvedAt: hours(-1),
      typeData: {
        spaceId: "TNK-204-INT",
        entryPoint: "Top manway",
        atmosphericTest: {
          o2Percent: 20.9,
          lelPercent: 0,
          h2sPpm: 0,
          coPpm: 0,
          testTime: new Date().toISOString(),
        },
        standbyAttendantName: "Suresh Babu",
        rescuePlan:
          "Retrieval line and winch at entry point, standby attendant maintains visual contact at all times",
        ventilationMethod: "Forced air blower",
        entryExitLog: [],
      },
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p3.id,
      approverId: areaOwner2.id,
      role: Role.AREA_OWNER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-2),
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p3.id,
      approverId: safetyOfficer.id,
      role: Role.SAFETY_OFFICER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-1),
    },
  });
  await logAudit(p3.id, safetyOfficer.id, "APPROVE", "PENDING", "APPROVED");

  // 4. CONFINED_SPACE - ACTIVE
  const p4 = await prisma.permit.create({
    data: {
      type: PermitType.CONFINED_SPACE,
      status: PermitStatus.ACTIVE,
      requesterId: requester.id,
      contractorName: "Deep Clean Services",
      workDescription: "Vessel internal inspection",
      areaId: areaTankFarm.id,
      equipmentId: eq5.id,
      plannedStart: hours(-1),
      plannedEnd: hours(5),
      hazards: ["oxygen deficiency"],
      ppeRequired: ["SCBA", "harness"],
      precautions: ["continuous ventilation", "standby attendant present"],
      submittedAt: hours(-8),
      approvedAt: hours(-3),
      activatedAt: hours(-1),
      typeData: {
        spaceId: "VSL-77-INT",
        entryPoint: "Side manway",
        atmosphericTest: {
          o2Percent: 20.8,
          lelPercent: 0,
          h2sPpm: 0,
          coPpm: 0,
          testTime: new Date().toISOString(),
        },
        standbyAttendantName: "Suresh Babu",
        rescuePlan:
          "Retrieval line and winch at entry point, standby attendant maintains visual contact at all times",
        ventilationMethod: "Forced air blower",
        entryExitLog: [
          { name: "Contract worker A", enteredAt: hours(-1).toISOString() },
        ],
      },
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p4.id,
      approverId: areaOwner2.id,
      role: Role.AREA_OWNER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-4),
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p4.id,
      approverId: safetyOfficer.id,
      role: Role.SAFETY_OFFICER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-3),
    },
  });
  await logAudit(p4.id, requester.id, "ACTIVATE", "APPROVED", "ACTIVE");

  // 5. WORKING_AT_HEIGHT - SUSPENDED
  const p5 = await prisma.permit.create({
    data: {
      type: PermitType.WORKING_AT_HEIGHT,
      status: PermitStatus.SUSPENDED,
      requesterId: requester.id,
      contractorName: "Skyline Access",
      workDescription: "Ladder access for lighting repair",
      areaId: areaUtilities.id,
      equipmentId: eq6.id,
      plannedStart: hours(-2),
      plannedEnd: hours(2),
      hazards: ["fall hazard"],
      ppeRequired: ["harness", "hard hat"],
      precautions: ["barricade below", "anchor point checked"],
      submittedAt: hours(-10),
      approvedAt: hours(-5),
      activatedAt: hours(-2),
      suspendedAt: hours(-1),
      typeData: {
        heightMeters: 6,
        accessMethod: "ladder",
        fallArrestEquipment: "Full body harness with lanyard",
        anchorPointChecked: true,
        barricadingBelow: true,
      },
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p5.id,
      approverId: areaOwner3.id,
      role: Role.AREA_OWNER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-6),
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p5.id,
      approverId: safetyOfficer.id,
      role: Role.SAFETY_OFFICER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-5),
    },
  });
  await logAudit(
    p5.id,
    safetyOfficer.id,
    "SUSPEND",
    "ACTIVE",
    "SUSPENDED",
    "Gas alarm triggered nearby, suspending as precaution",
  );

  // 6. WORKING_AT_HEIGHT - EXPIRED
  const p6 = await prisma.permit.create({
    data: {
      type: PermitType.WORKING_AT_HEIGHT,
      status: PermitStatus.EXPIRED,
      requesterId: requester.id,
      contractorName: "Skyline Access",
      workDescription: "Scaffold inspection near pipe rack",
      areaId: areaProcess.id,
      equipmentId: eq1.id,
      plannedStart: hours(-30),
      plannedEnd: hours(-26),
      hazards: ["fall hazard"],
      ppeRequired: ["harness"],
      precautions: ["barricade below"],
      submittedAt: hours(-40),
      approvedAt: hours(-32),
      activatedAt: hours(-30),
      expiredAt: hours(-26),
      typeData: {
        heightMeters: 4,
        accessMethod: "scaffold",
        fallArrestEquipment: "Full body harness",
        anchorPointChecked: true,
        barricadingBelow: true,
      },
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p6.id,
      approverId: areaOwner.id,
      role: Role.AREA_OWNER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-33),
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p6.id,
      approverId: safetyOfficer.id,
      role: Role.SAFETY_OFFICER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-32),
    },
  });
  await logAudit(
    p6.id,
    admin.id,
    "AUTO_EXPIRE",
    "ACTIVE",
    "EXPIRED",
    "Validity window passed",
  );

  // 7. ELECTRICAL_ISOLATION - REJECTED
  const p7 = await prisma.permit.create({
    data: {
      type: PermitType.ELECTRICAL_ISOLATION,
      status: PermitStatus.REJECTED,
      requesterId: requester.id,
      contractorName: "PowerSafe Electricals",
      workDescription: "Replace breaker in MCC panel",
      areaId: areaUtilities.id,
      equipmentId: eq3.id,
      plannedStart: hours(10),
      plannedEnd: hours(12),
      hazards: ["electrical shock"],
      ppeRequired: ["insulated gloves", "arc flash suit"],
      precautions: ["lockout applied", "tested dead before touch"],
      submittedAt: hours(-3),
      typeData: {
        equipmentTag: "PNL-11",
        voltageLevel: "415V",
        isolationPoints: ["Main breaker MCC-11"],
        lockNumbers: ["LK-2201"],
        tagNumbers: ["TG-2201"],
        earthingApplied: false,
        testedDeadBy: "Pending",
      },
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p7.id,
      approverId: areaOwner3.id,
      role: Role.AREA_OWNER,
      decision: ApprovalDecision.REJECTED,
      decidedAt: hours(-1),
      comment: "Earthing not applied - resubmit with earthing plan",
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p7.id,
      approverId: safetyOfficer.id,
      role: Role.SAFETY_OFFICER,
      decision: ApprovalDecision.PENDING,
    },
  });
  await logAudit(
    p7.id,
    areaOwner3.id,
    "REJECT",
    "PENDING_APPROVAL",
    "REJECTED",
    "Earthing not applied - resubmit with earthing plan",
  );

  // 8. ELECTRICAL_ISOLATION - CLOSED (work done, awaiting safety verification)
  const p8 = await prisma.permit.create({
    data: {
      type: PermitType.ELECTRICAL_ISOLATION,
      status: PermitStatus.CLOSED,
      requesterId: requester.id,
      contractorName: "PowerSafe Electricals",
      workDescription: "Isolate and inspect reactor vessel heater circuit",
      areaId: areaTankFarm.id,
      equipmentId: eq5.id,
      plannedStart: hours(-20),
      plannedEnd: hours(-16),
      hazards: ["electrical shock"],
      ppeRequired: ["insulated gloves"],
      precautions: [
        "lockout applied",
        "tested dead before touch",
        "earthing applied",
      ],
      submittedAt: hours(-26),
      approvedAt: hours(-22),
      activatedAt: hours(-20),
      closedAt: hours(-15),
      completionNotes:
        "Heater circuit inspected, no faults found, isolation removed",
      typeData: {
        equipmentTag: "VSL-77-HTR",
        voltageLevel: "415V",
        isolationPoints: ["Heater circuit breaker"],
        lockNumbers: ["LK-3301"],
        tagNumbers: ["TG-3301"],
        earthingApplied: true,
        testedDeadBy: "Karthik Owner",
      },
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p8.id,
      approverId: areaOwner2.id,
      role: Role.AREA_OWNER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-23),
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p8.id,
      approverId: safetyOfficer.id,
      role: Role.SAFETY_OFFICER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-22),
    },
  });
  await logAudit(
    p8.id,
    requester.id,
    "CLOSE",
    "ACTIVE",
    "CLOSED",
    "Heater circuit inspected, no faults found, isolation removed",
  );

  // 9. HOT_WORK - CLOSED_VERIFIED (full lifecycle complete)
  const p9 = await prisma.permit.create({
    data: {
      type: PermitType.HOT_WORK,
      status: PermitStatus.CLOSED_VERIFIED,
      requesterId: requester.id,
      contractorName: "SVR Fabricators",
      workDescription: "Grinding weld seam smooth on pipe rack",
      areaId: areaProcess.id,
      equipmentId: eq4.id,
      plannedStart: hours(-50),
      plannedEnd: hours(-46),
      hazards: ["sparks", "flammable vapour"],
      ppeRequired: ["face shield", "fire retardant suit"],
      precautions: ["fire watch present", "combustibles cleared"],
      submittedAt: hours(-56),
      approvedAt: hours(-52),
      activatedAt: hours(-50),
      closedAt: hours(-45),
      verifiedAt: hours(-44),
      completionNotes: "Weld seam ground smooth, area cleared",
      verificationNotes:
        "Site inspected, no combustibles left, fire watch stood down safely",
      typeData: {
        hotWorkType: "grinding",
        fireWatchAssigned: "Ravi Kumar",
        fireExtinguisherType: "CO2",
        combustiblesClearedRadiusMeters: 10,
        gasTest: {
          lelPercent: 0,
          o2Percent: 20.9,
          testTime: hours(-50).toISOString(),
        },
      },
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p9.id,
      approverId: areaOwner.id,
      role: Role.AREA_OWNER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-53),
    },
  });
  await prisma.approval.create({
    data: {
      permitId: p9.id,
      approverId: safetyOfficer.id,
      role: Role.SAFETY_OFFICER,
      decision: ApprovalDecision.APPROVED,
      decidedAt: hours(-52),
    },
  });
  await logAudit(
    p9.id,
    safetyOfficer.id,
    "VERIFY",
    "CLOSED",
    "CLOSED_VERIFIED",
    "Site inspected, no combustibles left",
  );

  // 10. CONFINED_SPACE - CANCELLED
  const p10 = await prisma.permit.create({
    data: {
      type: PermitType.CONFINED_SPACE,
      status: PermitStatus.CANCELLED,
      requesterId: requester.id,
      contractorName: "Deep Clean Services",
      workDescription:
        "Tank entry for sample collection - job cancelled by client",
      areaId: areaTankFarm.id,
      equipmentId: eq2.id,
      plannedStart: hours(30),
      plannedEnd: hours(34),
      hazards: ["oxygen deficiency"],
      ppeRequired: ["SCBA"],
      precautions: ["continuous ventilation"],
      submittedAt: hours(-1),
      cancelledAt: hours(0),
      typeData: {
        spaceId: "TNK-204-INT",
        entryPoint: "Top manway",
        atmosphericTest: {
          o2Percent: 20.9,
          lelPercent: 0,
          h2sPpm: 0,
          coPpm: 0,
          testTime: new Date().toISOString(),
        },
        standbyAttendantName: "Suresh Babu",
        rescuePlan: "Retrieval line and winch at entry point",
        ventilationMethod: "Forced air blower",
        entryExitLog: [],
      },
    },
  });
  await logAudit(
    p10.id,
    requester.id,
    "CANCEL",
    "PENDING_APPROVAL",
    "CANCELLED",
    "Client postponed the job",
  );

  console.log("10 permits created across all statuses and types.");
  console.log({
    admin: admin.email,
    safetyOfficer: safetyOfficer.email,
    requester: requester.email,
    areaOwner: areaOwner.email,
    areaOwner2: areaOwner2.email,
    areaOwner3: areaOwner3.email,
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
