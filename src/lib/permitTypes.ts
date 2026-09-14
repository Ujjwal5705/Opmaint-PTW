import { z } from "zod";

// --- Hot Work ---
export const hotWorkSchema = z.object({
  hotWorkType: z.enum(["welding", "grinding", "cutting", "soldering"]),
  fireWatchAssigned: z.string().min(1),
  fireExtinguisherType: z.string().min(1),
  combustiblesClearedRadiusMeters: z.number().positive(),
  gasTest: z.object({
    lelPercent: z.number().min(0).max(100),
    o2Percent: z.number().min(0).max(100),
    testTime: z.string(), // ISO datetime string
  }),
});

// --- Confined Space Entry ---
export const confinedSpaceSchema = z.object({
  spaceId: z.string().min(1),
  entryPoint: z.string().min(1),
  atmosphericTest: z.object({
    o2Percent: z.number().min(0).max(100),
    lelPercent: z.number().min(0).max(100),
    h2sPpm: z.number().min(0),
    coPpm: z.number().min(0),
    testTime: z.string(),
  }),
  standbyAttendantName: z.string().min(1),
  rescuePlan: z.string().min(1),
  ventilationMethod: z.string().min(1),
  entryExitLog: z
    .array(
      z.object({
        name: z.string(),
        enteredAt: z.string(),
        exitedAt: z.string().optional(),
      }),
    )
    .default([]),
});

// --- Working at Height ---
export const workingAtHeightSchema = z.object({
  heightMeters: z.number().positive(),
  accessMethod: z.enum(["scaffold", "ladder", "MEWP", "rope"]),
  fallArrestEquipment: z.string().min(1),
  anchorPointChecked: z.boolean(),
  barricadingBelow: z.boolean(),
});

// --- Electrical / Isolation (LOTO) ---
export const electricalIsolationSchema = z.object({
  equipmentTag: z.string().min(1),
  voltageLevel: z.string().min(1),
  isolationPoints: z.array(z.string()).min(1),
  lockNumbers: z.array(z.string()).min(1),
  tagNumbers: z.array(z.string()).min(1),
  earthingApplied: z.boolean(),
  testedDeadBy: z.string().min(1),
});

// --- Registry: maps a PermitType to its schema ---
// Adding a 5th type (e.g. Excavation) means adding ONE line here plus one schema above.
// No changes needed anywhere else that reads/writes typeData.
export const permitTypeSchemas = {
  HOT_WORK: hotWorkSchema,
  CONFINED_SPACE: confinedSpaceSchema,
  WORKING_AT_HEIGHT: workingAtHeightSchema,
  ELECTRICAL_ISOLATION: electricalIsolationSchema,
} as const;

export type PermitTypeKey = keyof typeof permitTypeSchemas;
