"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

type Equipment = { id: string; name: string; tag: string };
type Area = { id: string; name: string; equipment: Equipment[] };
type Plant = { id: string; name: string; areas: Area[] };

const PERMIT_TYPES = [
  { value: "HOT_WORK", label: "Hot Work" },
  { value: "CONFINED_SPACE", label: "Confined Space Entry" },
  { value: "WORKING_AT_HEIGHT", label: "Working at Height" },
  { value: "ELECTRICAL_ISOLATION", label: "Electrical / Isolation (LOTO)" },
];

type FormState = {
  type: string;
  areaId: string;
  equipmentId: string;
  contractorName: string;
  workDescription: string;
  plannedStart: string;
  plannedEnd: string;
  hazards: string;
  ppeRequired: string;
  precautions: string;
  typeData: Record<string, unknown>;
};

const TYPE_DEFAULTS: Record<string, Record<string, unknown>> = {
  HOT_WORK: {
    hotWorkType: "",
    fireWatchAssigned: "",
    fireExtinguisherType: "",
    combustiblesClearedRadiusMeters: undefined,
    gasTest: {
      lelPercent: 0,
      o2Percent: 20.9,
      testTime: new Date().toISOString(),
    },
  },
  CONFINED_SPACE: {
    spaceId: "",
    entryPoint: "",
    atmosphericTest: {
      o2Percent: 20.9,
      lelPercent: 0,
      h2sPpm: 0,
      coPpm: 0,
      testTime: new Date().toISOString(),
    },
    standbyAttendantName: "",
    rescuePlan: "",
    ventilationMethod: "",
    entryExitLog: [],
  },
  WORKING_AT_HEIGHT: {
    heightMeters: undefined,
    accessMethod: "",
    fallArrestEquipment: "",
    anchorPointChecked: false,
    barricadingBelow: false,
  },
  ELECTRICAL_ISOLATION: {
    equipmentTag: "",
    voltageLevel: "",
    isolationPoints: [],
    lockNumbers: [],
    tagNumbers: [],
    earthingApplied: false,
    testedDeadBy: "",
  },
};

const EMPTY_FORM: FormState = {
  type: "",
  areaId: "",
  equipmentId: "",
  contractorName: "",
  workDescription: "",
  plannedStart: "",
  plannedEnd: "",
  hazards: "",
  ppeRequired: "",
  precautions: "",
  typeData: {},
};

export default function NewPermitWizard({ plants }: { plants: Plant[] }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allAreas = useMemo(
    () =>
      plants.flatMap((p) => p.areas.map((a) => ({ ...a, plantName: p.name }))),
    [plants],
  );
  const selectedArea = allAreas.find((a) => a.id === form.areaId);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateTypeData(key: string, value: unknown) {
    setForm((f) => ({ ...f, typeData: { ...f.typeData, [key]: value } }));
  }

  function step1Valid() {
    return (
      form.type &&
      form.areaId &&
      form.equipmentId &&
      form.contractorName.trim() &&
      form.workDescription.trim() &&
      form.plannedStart &&
      form.plannedEnd
    );
  }

  function step2Valid() {
    if (form.type === "HOT_WORK") {
      return (
        form.typeData.hotWorkType &&
        form.typeData.fireWatchAssigned &&
        form.typeData.fireExtinguisherType &&
        form.typeData.combustiblesClearedRadiusMeters !== undefined &&
        form.typeData.gasTest
      );
    }
    if (form.type === "CONFINED_SPACE") {
      return (
        form.typeData.spaceId &&
        form.typeData.entryPoint &&
        form.typeData.atmosphericTest &&
        form.typeData.standbyAttendantName &&
        form.typeData.rescuePlan &&
        form.typeData.ventilationMethod
      );
    }
    if (form.type === "WORKING_AT_HEIGHT") {
      return (
        form.typeData.heightMeters !== undefined &&
        form.typeData.accessMethod &&
        form.typeData.fallArrestEquipment
      );
    }
    if (form.type === "ELECTRICAL_ISOLATION") {
      return (
        form.typeData.equipmentTag &&
        form.typeData.voltageLevel &&
        form.typeData.testedDeadBy
      );
    }
    return false;
  }

  async function save(alsoSubmit: boolean) {
    setSaving(true);
    setError(null);

    const body = {
      type: form.type,
      contractorName: form.contractorName,
      workDescription: form.workDescription,
      areaId: form.areaId,
      equipmentId: form.equipmentId,
      plannedStart: new Date(form.plannedStart).toISOString(),
      plannedEnd: new Date(form.plannedEnd).toISOString(),
      hazards: form.hazards
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      ppeRequired: form.ppeRequired
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      precautions: form.precautions
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      typeData: buildTypeData(form),
    };

    const res = await fetch("/api/permits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to save permit");
      setSaving(false);
      return;
    }

    const { permit } = await res.json();

    if (alsoSubmit) {
      const submitRes = await fetch(`/api/permits/${permit.id}/submit`, {
        method: "POST",
      });
      if (!submitRes.ok) {
        const data = await submitRes.json().catch(() => ({}));
        setError(`Permit saved as draft, but submit failed: ${data.error}`);
        setSaving(false);
        router.push(`/permits/${permit.id}`);
        return;
      }
    }

    router.push(`/permits/${permit.id}`);
  }

  return (
    <div className="space-y-6">
      <StepIndicator step={step} />

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </p>
      )}

      {step === 1 && (
        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <Field label="Permit Type">
            <select
              value={form.type}
              onChange={(e) =>
                setForm((f) => ({
                  ...EMPTY_FORM,
                  type: e.target.value,
                  typeData: TYPE_DEFAULTS[e.target.value] ?? {},
                }))
              }
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="">Select a type...</option>
              {PERMIT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Area">
            <select
              value={form.areaId}
              onChange={(e) => {
                update("areaId", e.target.value);
                update("equipmentId", "");
              }}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="">Select an area...</option>
              {allAreas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.plantName} → {a.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Equipment">
            <select
              value={form.equipmentId}
              onChange={(e) => update("equipmentId", e.target.value)}
              disabled={!selectedArea}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:bg-gray-50"
            >
              <option value="">Select equipment...</option>
              {selectedArea?.equipment.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.name} ({eq.tag})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Contractor / Team">
            <input
              value={form.contractorName}
              onChange={(e) => update("contractorName", e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="e.g. SVR Fabricators"
            />
          </Field>

          <Field label="Work Description">
            <textarea
              value={form.workDescription}
              onChange={(e) => update("workDescription", e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              rows={2}
              placeholder="Exact job to be done"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Planned Start">
              <input
                type="datetime-local"
                value={form.plannedStart}
                onChange={(e) => update("plannedStart", e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Planned End">
              <input
                type="datetime-local"
                value={form.plannedEnd}
                onChange={(e) => update("plannedEnd", e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </Field>
          </div>

          <Field label="Hazards (comma-separated)">
            <input
              value={form.hazards}
              onChange={(e) => update("hazards", e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="flammable vapour, falling debris"
            />
          </Field>
          <Field label="PPE Required (comma-separated)">
            <input
              value={form.ppeRequired}
              onChange={(e) => update("ppeRequired", e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="fire retardant suit, hard hat"
            />
          </Field>
          <Field label="Precautions (comma-separated)">
            <input
              value={form.precautions}
              onChange={(e) => update("precautions", e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="isolate line, fire watch present"
            />
          </Field>

          <div className="flex justify-end">
            <button
              disabled={!step1Valid()}
              onClick={() => setStep(2)}
              className="bg-gray-900 text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-40"
            >
              Next: Type-Specific Details
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <TypeSpecificFields
            type={form.type}
            typeData={form.typeData}
            update={updateTypeData}
          />
          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep(1)}
              className="text-sm text-gray-500 border border-gray-300 rounded-md px-4 py-2"
            >
              Back
            </button>
            <button
              disabled={!step2Valid()}
              onClick={() => setStep(3)}
              className="bg-gray-900 text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-40"
            >
              Next: Review
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Review</h2>
          <ReviewSummary
            form={form}
            areaLabel={
              selectedArea
                ? `${selectedArea.plantName} → ${selectedArea.name}`
                : ""
            }
          />
          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep(2)}
              className="text-sm text-gray-500 border border-gray-300 rounded-md px-4 py-2"
            >
              Back
            </button>
            <div className="flex gap-2">
              <button
                disabled={saving}
                onClick={() => save(false)}
                className="text-sm text-gray-700 border border-gray-300 rounded-md px-4 py-2 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save as Draft"}
              </button>
              <button
                disabled={saving}
                onClick={() => save(true)}
                className="bg-gray-900 text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save & Submit for Approval"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildTypeData(form: FormState): Record<string, unknown> {
  return form.typeData;
}

function StepIndicator({ step }: { step: number }) {
  const labels = ["Job Details", "Type-Specific", "Review"];
  return (
    <div className="flex gap-2">
      {labels.map((label, i) => (
        <div
          key={label}
          className={`flex-1 text-center text-xs font-medium py-2 rounded-md ${i + 1 === step ? "bg-gray-900 text-white" : i + 1 < step ? "bg-gray-200 text-gray-600" : "bg-gray-100 text-gray-400"}`}
        >
          {i + 1}. {label}
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function ReviewSummary({
  form,
  areaLabel,
}: {
  form: FormState;
  areaLabel: string;
}) {
  return (
    <dl className="text-sm space-y-2">
      <Row
        label="Type"
        value={PERMIT_TYPES.find((t) => t.value === form.type)?.label ?? ""}
      />
      <Row label="Area" value={areaLabel} />
      <Row label="Contractor" value={form.contractorName} />
      <Row label="Work" value={form.workDescription} />
      <Row label="Window" value={`${form.plannedStart} → ${form.plannedEnd}`} />
      <Row label="Hazards" value={form.hazards || "—"} />
      <Row label="PPE" value={form.ppeRequired || "—"} />
      <Row label="Precautions" value={form.precautions || "—"} />
      <Row label="Type-specific data" value={JSON.stringify(form.typeData)} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-gray-400 w-32 shrink-0">{label}</dt>
      <dd className="text-gray-800">{value}</dd>
    </div>
  );
}

// --- Type-specific field groups ---

function TypeSpecificFields({
  type,
  typeData,
  update,
}: {
  type: string;
  typeData: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
}) {
  const inputCls = "w-full border border-gray-300 rounded-md px-3 py-2 text-sm";

  if (type === "HOT_WORK") {
    return (
      <>
        <Field label="Type of Hot Work">
          <select
            value={(typeData.hotWorkType as string) ?? ""}
            onChange={(e) => update("hotWorkType", e.target.value)}
            className={inputCls}
          >
            <option value="">Select...</option>
            <option value="welding">Welding</option>
            <option value="grinding">Grinding</option>
            <option value="cutting">Cutting</option>
            <option value="soldering">Soldering</option>
          </select>
        </Field>
        <Field label="Fire Watch Assigned">
          <input
            className={inputCls}
            value={(typeData.fireWatchAssigned as string) ?? ""}
            onChange={(e) => update("fireWatchAssigned", e.target.value)}
          />
        </Field>
        <Field label="Fire Extinguisher Type">
          <input
            className={inputCls}
            value={(typeData.fireExtinguisherType as string) ?? ""}
            onChange={(e) => update("fireExtinguisherType", e.target.value)}
            placeholder="e.g. CO2, DCP"
          />
        </Field>
        <Field label="Combustibles Cleared Radius (metres)">
          <input
            type="number"
            className={inputCls}
            value={(typeData.combustiblesClearedRadiusMeters as number) ?? ""}
            onChange={(e) =>
              update("combustiblesClearedRadiusMeters", Number(e.target.value))
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Gas Test — LEL %">
            <input
              type="number"
              className={inputCls}
              onChange={(e) =>
                update("gasTest", {
                  ...(typeData.gasTest as object),
                  lelPercent: Number(e.target.value),
                  testTime: new Date().toISOString(),
                })
              }
            />
          </Field>
          <Field label="Gas Test — O₂ %">
            <input
              type="number"
              className={inputCls}
              onChange={(e) =>
                update("gasTest", {
                  ...(typeData.gasTest as object),
                  o2Percent: Number(e.target.value),
                  testTime: new Date().toISOString(),
                })
              }
            />
          </Field>
        </div>
      </>
    );
  }

  if (type === "CONFINED_SPACE") {
    return (
      <>
        <Field label="Space ID">
          <input
            className={inputCls}
            value={(typeData.spaceId as string) ?? ""}
            onChange={(e) => update("spaceId", e.target.value)}
          />
        </Field>
        <Field label="Entry Point">
          <input
            className={inputCls}
            value={(typeData.entryPoint as string) ?? ""}
            onChange={(e) => update("entryPoint", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="O₂ %">
            <input
              type="number"
              className={inputCls}
              onChange={(e) =>
                update("atmosphericTest", {
                  ...(typeData.atmosphericTest as object),
                  o2Percent: Number(e.target.value),
                  testTime: new Date().toISOString(),
                })
              }
            />
          </Field>
          <Field label="LEL %">
            <input
              type="number"
              className={inputCls}
              onChange={(e) =>
                update("atmosphericTest", {
                  ...(typeData.atmosphericTest as object),
                  lelPercent: Number(e.target.value),
                  testTime: new Date().toISOString(),
                })
              }
            />
          </Field>
          <Field label="H₂S ppm">
            <input
              type="number"
              className={inputCls}
              onChange={(e) =>
                update("atmosphericTest", {
                  ...(typeData.atmosphericTest as object),
                  h2sPpm: Number(e.target.value),
                  testTime: new Date().toISOString(),
                })
              }
            />
          </Field>
          <Field label="CO ppm">
            <input
              type="number"
              className={inputCls}
              onChange={(e) =>
                update("atmosphericTest", {
                  ...(typeData.atmosphericTest as object),
                  coPpm: Number(e.target.value),
                  testTime: new Date().toISOString(),
                })
              }
            />
          </Field>
        </div>
        <Field label="Standby Attendant Name">
          <input
            className={inputCls}
            value={(typeData.standbyAttendantName as string) ?? ""}
            onChange={(e) => update("standbyAttendantName", e.target.value)}
          />
        </Field>
        <Field label="Rescue Plan">
          <textarea
            className={inputCls}
            rows={2}
            value={(typeData.rescuePlan as string) ?? ""}
            onChange={(e) => update("rescuePlan", e.target.value)}
          />
        </Field>
        <Field label="Ventilation Method">
          <input
            className={inputCls}
            value={(typeData.ventilationMethod as string) ?? ""}
            onChange={(e) => update("ventilationMethod", e.target.value)}
          />
        </Field>
      </>
    );
  }

  if (type === "WORKING_AT_HEIGHT") {
    return (
      <>
        <Field label="Height (metres)">
          <input
            type="number"
            className={inputCls}
            value={(typeData.heightMeters as number) ?? ""}
            onChange={(e) => update("heightMeters", Number(e.target.value))}
          />
        </Field>
        <Field label="Access Method">
          <select
            value={(typeData.accessMethod as string) ?? ""}
            onChange={(e) => update("accessMethod", e.target.value)}
            className={inputCls}
          >
            <option value="">Select...</option>
            <option value="scaffold">Scaffold</option>
            <option value="ladder">Ladder</option>
            <option value="MEWP">MEWP</option>
            <option value="rope">Rope</option>
          </select>
        </Field>
        <Field label="Fall Arrest Equipment">
          <input
            className={inputCls}
            value={(typeData.fallArrestEquipment as string) ?? ""}
            onChange={(e) => update("fallArrestEquipment", e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={(typeData.anchorPointChecked as boolean) ?? false}
            onChange={(e) => update("anchorPointChecked", e.target.checked)}
          />
          Anchor point checked
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={(typeData.barricadingBelow as boolean) ?? false}
            onChange={(e) => update("barricadingBelow", e.target.checked)}
          />
          Barricading below in place
        </label>
      </>
    );
  }

  if (type === "ELECTRICAL_ISOLATION") {
    return (
      <>
        <Field label="Equipment Tag">
          <input
            className={inputCls}
            value={(typeData.equipmentTag as string) ?? ""}
            onChange={(e) => update("equipmentTag", e.target.value)}
          />
        </Field>
        <Field label="Voltage Level">
          <input
            className={inputCls}
            value={(typeData.voltageLevel as string) ?? ""}
            onChange={(e) => update("voltageLevel", e.target.value)}
            placeholder="e.g. 415V"
          />
        </Field>
        <Field label="Isolation Points (comma-separated)">
          <input
            className={inputCls}
            onChange={(e) =>
              update(
                "isolationPoints",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
        <Field label="Lock Numbers (comma-separated)">
          <input
            className={inputCls}
            onChange={(e) =>
              update(
                "lockNumbers",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
        <Field label="Tag Numbers (comma-separated)">
          <input
            className={inputCls}
            onChange={(e) =>
              update(
                "tagNumbers",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={(typeData.earthingApplied as boolean) ?? false}
            onChange={(e) => update("earthingApplied", e.target.checked)}
          />
          Earthing applied
        </label>
        <Field label="Tested Dead By">
          <input
            className={inputCls}
            value={(typeData.testedDeadBy as string) ?? ""}
            onChange={(e) => update("testedDeadBy", e.target.value)}
          />
        </Field>
      </>
    );
  }

  return null;
}
