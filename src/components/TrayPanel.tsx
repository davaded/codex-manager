import React from "react";
import { clsx } from "clsx";
import { useAccountStore } from "../store/accountStore";
import { Account } from "../types";
import { formatRelativeTime, getAccountInsight, getRecommendedAccountId } from "../utils/dashboard";

function shortSessionId(sessionId: string | null | undefined): string | null {
  if (!sessionId) {
    return null;
  }
  if (sessionId.length <= 12) {
    return sessionId;
  }
  return `${sessionId.slice(0, 8)}...${sessionId.slice(-4)}`;
}

interface TrayPanelProps {
  isRefreshing: boolean;
  refreshingAccountIds: string[];
  isImportingCurrentAuth: boolean;
  isSmartSwitching: boolean;
  resumingSessionId: string | null;
  onRefreshUsage: () => Promise<void>;
  onRefreshAccount: (id: string) => Promise<void>;
  onImportCurrentAuth: () => Promise<void>;
  onSmartSwitch: () => Promise<void>;
  onResumeSession: (sessionId: string) => Promise<void>;
  onSwitch: (account: Account) => void;
}

const TrayPanel: React.FC<TrayPanelProps> = ({
  isRefreshing,
  refreshingAccountIds,
  isImportingCurrentAuth,
  isSmartSwitching,
  resumingSessionId,
  onRefreshUsage,
  onRefreshAccount,
  onImportCurrentAuth,
  onSmartSwitch,
  onResumeSession,
  onSwitch,
}) => {
  const { accounts, setAddModalOpen, switchState } = useAccountStore();
  const recommendedId = getRecommendedAccountId(accounts);
  const isSwitching = switchState.phase !== "idle";

  return (
    <section className="mx-auto w-full max-w-[420px] rounded-[28px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(244,247,255,0.98)_100%)] p-4 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.55)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-indigo-500/80">
            Tray Panel
          </p>
          <h2 className="mt-1 text-[1.35rem] font-black tracking-[-0.04em] text-slate-950">
            快速切换
          </h2>
        </div>
        <button
          onClick={() => void onRefreshUsage()}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg
            className={clsx("h-3.5 w-3.5", isRefreshing && "animate-spin")}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          刷新
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => void onImportCurrentAuth()}
          disabled={isImportingCurrentAuth}
          className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.7)] transition-all hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isImportingCurrentAuth ? "导入中..." : "导入当前授权"}
        </button>
        <button
          onClick={() => void onSmartSwitch()}
          disabled={isSmartSwitching}
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-700 transition-all hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSmartSwitching ? "智能切换中..." : "智能切换"}
        </button>
        <button
          onClick={() => setAddModalOpen(true)}
          className="rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-3 text-sm font-semibold text-indigo-700 transition-all hover:border-indigo-300"
        >
          添加账号
        </button>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
          账户数 <span className="font-semibold text-slate-900">{accounts.length}</span>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {accounts.length === 0 && (
          <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/80 px-4 py-8 text-center text-sm text-slate-500">
            暂无账户，先导入当前授权或添加 OAuth 账户。
          </div>
        )}

        {accounts.map((account) => {
          const insight = getAccountInsight(account);
          const isActive = account.isActive;
          const isSelfRefreshing = refreshingAccountIds.includes(account.id);
          const currentSessionId = account.sessionInfo?.currentSessionId ?? null;
          const sessionIdLabel = shortSessionId(account.sessionInfo?.currentSessionId);

          return (
            <article
              key={account.id}
              className={clsx(
                "rounded-[24px] border px-4 py-3 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.4)]",
                isActive
                  ? "border-indigo-300 bg-indigo-50/70"
                  : "border-slate-200 bg-white/90",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-bold tracking-[-0.03em] text-slate-950">
                      {account.displayName}
                    </h3>
                    {recommendedId === account.id && !isActive && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        推荐
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {account.email ?? account.userId ?? "未绑定邮箱"}
                  </p>
                </div>

                <span
                  className={clsx(
                    "rounded-full px-2 py-1 text-[10px] font-semibold",
                    isActive ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {isActive ? "当前" : insight.roleLabel}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                {[insight.hourlyQuota, insight.weeklyQuota].map((metric) => (
                  <div key={metric.label}>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      {metric.label.includes("5小时") ? "5H" : "WEEK"}
                    </div>
                    <div className="mt-1 text-sm font-bold text-slate-950">{metric.valueLabel}</div>
                    <div className="mt-0.5 text-[10px] leading-4 text-slate-500">{metric.detail}</div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                <span>最近切换 {formatRelativeTime(account.lastSwitchedAt)}</span>
                <button
                  onClick={() => void onRefreshAccount(account.id)}
                  disabled={isRefreshing || isSelfRefreshing}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <svg
                    className={clsx("h-3 w-3", (isRefreshing || isSelfRefreshing) && "animate-spin")}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  刷新
                </button>
              </div>

              {(account.sessionInfo?.currentThreadName || sessionIdLabel) && (
                <div className="mt-2 rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                  {account.sessionInfo?.currentThreadName && (
                    <div
                      className="truncate text-[10px] font-medium text-slate-600"
                      title={account.sessionInfo.currentThreadName}
                    >
                      {account.sessionInfo.currentThreadName}
                    </div>
                  )}
                  {sessionIdLabel && (
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      会话 {sessionIdLabel}
                    </div>
                  )}
                  {currentSessionId && (
                    <button
                      onClick={() => void onResumeSession(currentSessionId)}
                      disabled={resumingSessionId === currentSessionId}
                      className="mt-2 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <svg
                        className={clsx("h-3 w-3", resumingSessionId === currentSessionId && "animate-spin")}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.8}
                          d="M8 5v14l11-7-11-7z"
                        />
                      </svg>
                      {resumingSessionId === currentSessionId ? "恢复中..." : "恢复会话"}
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={() => !isActive && onSwitch(account)}
                disabled={isActive || isSwitching}
                className={clsx(
                  "mt-3 w-full rounded-2xl px-4 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed",
                  isActive
                    ? "border border-indigo-100 bg-indigo-100/70 text-indigo-600"
                    : "bg-slate-950 text-white hover:bg-slate-800",
                )}
              >
                {isActive ? "正在使用中" : isSwitching ? "切换中..." : "切换到此账户"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default TrayPanel;
