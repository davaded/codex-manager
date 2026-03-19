import React from "react";
import { useAccountStore } from "../store/accountStore";
import { SwitchPhase } from "../types";

const PHASES: { key: SwitchPhase; label: string; order: number }[] = [
  { key: "snapshotting", label: "确认当前共享会话状态", order: 1 },
  { key: "restoring", label: "切换目标账号身份", order: 2 },
  { key: "writing_auth", label: "保持当前会话继续可用", order: 3 },
];

function getIcon(
  phaseKey: SwitchPhase,
  currentPhase: SwitchPhase,
): string {
  if (currentPhase === "done") return "✅";
  if (currentPhase === "error") return "❌";

  const current = PHASES.find((p) => p.key === currentPhase)?.order ?? 0;
  const item = PHASES.find((p) => p.key === phaseKey)?.order ?? 0;

  if (item < current) return "✅";
  if (item === current) return "⏳";
  return "⬜";
}

const SwitchProgress: React.FC = () => {
  const { switchState, accounts } = useAccountStore();
  const { phase } = switchState;

  if (phase === "idle") return null;

  const target = accounts.find((a) => a.id === switchState.toAccountId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="switch-progress-title"
      aria-live="polite"
    >
      <div className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-8 shadow-[0_28px_80px_-35px_rgba(15,23,42,0.5)]">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-indigo-500/80">
          Switching
        </p>
        <h2
          id="switch-progress-title"
          className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950"
        >
          正在切换至 &ldquo;{target?.displayName ?? "..."}&rdquo;
        </h2>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          会保持当前共享会话仓库不变，只切换目标账户的登录凭证。
        </p>

        <div className="mt-7 space-y-4 rounded-[24px] border border-slate-100 bg-slate-50/90 p-5">
          {PHASES.map((p) => {
            const icon = getIcon(p.key, phase);
            const isDone = icon === "✅";
            const isActive = icon === "⏳";
            return (
              <div key={p.key} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3">
                <span className="text-base w-5 text-center" aria-hidden="true">
                  {icon}
                </span>
                <span
                  className={
                    isDone || isActive
                      ? "text-sm text-slate-800"
                      : "text-sm text-slate-400"
                  }
                >
                  {p.label}
                </span>
              </div>
            );
          })}
        </div>

        {phase === "error" && switchState.error && (
          <p className="mt-4 text-xs text-red-600">
            {switchState.error}
          </p>
        )}
      </div>
    </div>
  );
};

export default SwitchProgress;
