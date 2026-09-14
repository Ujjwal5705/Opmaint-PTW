"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ActionFlags = {
  canSubmit: boolean;
  canActivate: boolean;
  canSuspend: boolean;
  canResume: boolean;
  canClose: boolean;
  canVerify: boolean;
  canCancel: boolean;
};

type ApprovalFlag = {
  id: string;
  role: string;
  decision: string;
  canDecide: boolean;
};

export default function PermitActions({
  permitId,
  actions,
  approvals,
}: {
  permitId: string;
  status: string;
  actions: ActionFlags;
  approvals: ApprovalFlag[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptFor, setPromptFor] = useState<null | {
    kind: string;
    label: string;
    requireText: boolean;
  }>(null);
  const [textInput, setTextInput] = useState("");

  async function callAction(path: string, body?: Record<string, unknown>) {
    setLoading(path);
    setError(null);
    const res = await fetch(`/api/permits/${permitId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    setLoading(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Action failed");
      return;
    }
    setPromptFor(null);
    setTextInput("");
    router.refresh();
  }

  const hasAnyAction =
    actions.canSubmit ||
    actions.canActivate ||
    actions.canSuspend ||
    actions.canResume ||
    actions.canClose ||
    actions.canVerify ||
    actions.canCancel ||
    approvals.some((a) => a.canDecide);

  if (!hasAnyAction && !promptFor) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {promptFor ? (
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">
            {promptFor.label}
          </label>
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            rows={3}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              disabled={promptFor.requireText && textInput.trim().length === 0}
              onClick={() => runPromptedAction(promptFor.kind, textInput)}
              className="bg-gray-900 text-white text-sm rounded-md px-3 py-1.5 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              onClick={() => {
                setPromptFor(null);
                setTextInput("");
              }}
              className="text-sm text-gray-500 border border-gray-300 rounded-md px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.canSubmit && (
            <ActionButton
              loading={loading === "submit"}
              onClick={() => callAction("submit")}
            >
              Submit for Approval
            </ActionButton>
          )}

          {approvals
            .filter((a) => a.canDecide)
            .map((a) => (
              <div key={a.id} className="flex gap-2">
                <ActionButton
                  loading={loading === "approve"}
                  variant="primary"
                  onClick={() =>
                    callAction("approve", {
                      role: a.role,
                      decision: "APPROVED",
                    })
                  }
                >
                  Approve ({a.role.replace("_", " ")})
                </ActionButton>
                <ActionButton
                  loading={false}
                  variant="danger"
                  onClick={() =>
                    setPromptFor({
                      kind: `reject:${a.role}`,
                      label: "Reason for rejection (required)",
                      requireText: true,
                    })
                  }
                >
                  Reject
                </ActionButton>
              </div>
            ))}

          {actions.canActivate && (
            <ActionButton
              loading={loading === "activate"}
              variant="primary"
              onClick={() => callAction("activate")}
            >
              Activate
            </ActionButton>
          )}

          {actions.canSuspend && (
            <ActionButton
              loading={false}
              variant="danger"
              onClick={() =>
                setPromptFor({
                  kind: "suspend",
                  label: "Reason for suspension (required)",
                  requireText: true,
                })
              }
            >
              Suspend
            </ActionButton>
          )}

          {actions.canResume && (
            <ActionButton
              loading={loading === "resume"}
              variant="primary"
              onClick={() => callAction("resume")}
            >
              Resume
            </ActionButton>
          )}

          {actions.canClose && (
            <ActionButton
              loading={false}
              onClick={() =>
                setPromptFor({
                  kind: "close",
                  label: "Completion notes (required)",
                  requireText: true,
                })
              }
            >
              Mark Work Complete
            </ActionButton>
          )}

          {actions.canVerify && (
            <ActionButton
              loading={false}
              variant="primary"
              onClick={() =>
                setPromptFor({
                  kind: "verify",
                  label: "Verification notes (required)",
                  requireText: true,
                })
              }
            >
              Verify & Close
            </ActionButton>
          )}

          {actions.canCancel && (
            <ActionButton
              loading={false}
              variant="danger"
              onClick={() =>
                setPromptFor({
                  kind: "cancel",
                  label: "Reason for cancellation (optional)",
                  requireText: false,
                })
              }
            >
              Cancel Permit
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );

  function runPromptedAction(kind: string, text: string) {
    if (kind.startsWith("reject:")) {
      const role = kind.split(":")[1];
      return callAction("approve", {
        role,
        decision: "REJECTED",
        comment: text,
      });
    }
    if (kind === "suspend") return callAction("suspend", { comment: text });
    if (kind === "close") return callAction("close", { completionNotes: text });
    if (kind === "verify")
      return callAction("verify", { verificationNotes: text });
    if (kind === "cancel") return callAction("cancel", { comment: text });
  }
}

function ActionButton({
  children,
  onClick,
  loading,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  loading: boolean;
  variant?: "default" | "primary" | "danger";
}) {
  const styles = {
    default: "border border-gray-300 text-gray-700",
    primary: "bg-gray-900 text-white",
    danger: "border border-red-300 text-red-700",
  };
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`text-sm font-medium rounded-md px-3 py-1.5 disabled:opacity-50 ${styles[variant]}`}
    >
      {loading ? "..." : children}
    </button>
  );
}
