import React, { Suspense, useEffect, useState } from "react";
import { clsx } from "clsx";
import { Account } from "../types";
import { useAccountStore } from "../store/accountStore";
import { formatRelativeTime, getAccountInsight } from "../utils/dashboard";

const UsageChart = React.lazy(() => import("./UsageChart"));

interface AccountCardProps {
  account: Account;
  isRecommended: boolean;
  isRefreshing: boolean;
  isRefreshingSelf: boolean;
  onDelete: (id: string) => void;
  onRefresh: () => Promise<void>;
  onRename: (id: string, displayName: string) => Promise<void>;
  onSwitch: (account: Account) => void;
}

const ROLE_STYLES = {
  plus: "border-violet-200 bg-violet-50 text-violet-700",
  pro: "border-amber-200 bg-amber-50 text-amber-700",
  team: "border-blue-200 bg-blue-50 text-blue-700",
  enterprise: "border-slate-300 bg-slate-100 text-slate-700",
  business: "border-cyan-200 bg-cyan-50 text-cyan-700",
  free: "border-emerald-200 bg-emerald-50 text-emerald-700",
  unknown: "border-slate-200 bg-slate-50 text-slate-600",
} as const;

const AccountCard: React.FC<AccountCardProps> = ({
  account,
  isRecommended,
  isRefreshing,
  isRefreshingSelf,
  onDelete,
  onRefresh,
  onRename,
  onSwitch,
}) => {
  const { switchState } = useAccountStore();
  const insight = getAccountInsight(account);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(account.displayName);
  const [isSavingName, setIsSavingName] = useState(false);

  const isSwitching = switchState.phase !== "idle";
  const isActive = account.isActive;
  const isSwitchTarget = switchState.toAccountId === account.id && isSwitching;
  const isQuotaRefreshing = isRefreshing || isRefreshingSelf;
  const statusLabel = isActive ? "当前使用中" : isSwitchTarget ? "正在切换" : "可切换";
  const shortAccountId = account.accountId ? account.accountId.slice(-8) : null;

  useEffect(() => {
    setDraftName(account.displayName);
  }, [account.displayName]);

  const handleSaveName = async () => {
    if (!draftName.trim()) {
      return;
    }

    setIsSavingName(true);
    try {
      await onRename(account.id, draftName);
      setIsEditing(false);
    } finally {
      setIsSavingName(false);
    }
  };

  return (
    <article
      className={clsx(
        "relative w-full rounded-[20px] border bg-white p-4 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.28)] transition-all",
        isActive
          ? "border-indigo-500 ring-4 ring-indigo-50"
          : "border-slate-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_50px_-34px_rgba(15,23,42,0.32)]",
      )}
    >
      {isRecommended && !isActive && (
        <div className="absolute -right-2 -top-2 rounded-full bg-[#ffbf1f] px-2.5 py-1 text-[10px] font-bold text-slate-900 shadow-[0_14px_30px_-20px_rgba(245,158,11,0.95)]">
          ⚡ 最佳备用
        </div>
      )}

      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleSaveName();
                  }
                  if (event.key === "Escape") {
                    setDraftName(account.displayName);
                    setIsEditing(false);
                  }
                }}
                className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[1.05rem] font-semibold text-slate-950 outline-none ring-0 focus:border-indigo-400"
                autoFocus
              />
              <button
                onClick={() => void handleSaveName()}
                disabled={isSavingName}
                className="rounded-lg p-1 text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-50"
                aria-label={`保存 ${account.displayName} 的名称`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </button>
            </div>
          ) : (
            <div className="group flex items-center gap-1.5">
              <h3 className="truncate text-[1.15rem] font-bold tracking-[-0.03em] text-slate-950">
                {account.displayName}
              </h3>
              <button
                onClick={() => {
                  setDraftName(account.displayName);
                  setIsEditing(true);
                }}
                className="rounded-md p-1 text-slate-300 opacity-0 transition-all hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100"
                aria-label={`编辑 ${account.displayName} 名称`}
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.586 2.586a2 2 0 112.828 2.828L12 14.828l-4 1 1-4 9.586-9.242z"
                  />
                </svg>
              </button>
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-xl border px-2 py-1 text-[11px] font-medium",
                ROLE_STYLES[insight.roleTone],
              )}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {insight.roleTone === "free" || insight.roleTone === "plus" || insight.roleTone === "pro" ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M5.121 17.804A8.962 8.962 0 0112 15c2.458 0 4.687.991 6.304 2.596M15 9a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                )}
              </svg>
              {insight.roleLabel}
            </span>
            <span className="truncate">{account.email ?? account.userId ?? "未绑定邮箱"}</span>
            {shortAccountId && (
              <span className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
                Team {shortAccountId}
              </span>
            )}
          </div>
        </div>

        {isActive && (
          <div className="rounded-md border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">
            ● 当前活跃
          </div>
        )}
      </div>

      <div className="relative mt-4">
        <div
          className={clsx(
            "grid grid-cols-2 gap-2.5 transition-opacity duration-200",
            isQuotaRefreshing && "opacity-45",
          )}
        >
        {[insight.hourlyQuota, insight.weeklyQuota].map((metric) => (
          <div
            key={metric.label}
            className="rounded-[20px] border border-slate-100 bg-[linear-gradient(180deg,_rgba(248,250,252,0.96)_0%,_rgba(255,255,255,0.98)_100%)] px-2.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]"
          >
            <Suspense fallback={<div className="mx-auto h-[96px] w-full rounded-2xl bg-slate-100/80" />}>
              <UsageChart metric={metric} />
            </Suspense>
            <div className="mt-1 text-center">
              <div className="text-[11px] font-semibold tracking-[0.01em] text-slate-500">
                {metric.label}
              </div>
              <div className="mt-1 text-[13px] font-semibold text-slate-950">
                {metric.valueLabel}
              </div>
              <div className="mt-1 text-[10px] leading-4 text-indigo-500">
                {metric.detail}
              </div>
            </div>
          </div>
        ))}
        </div>
        {isQuotaRefreshing && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[24px]">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/92 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 shadow-[0_12px_26px_-16px_rgba(79,70,229,0.45)] backdrop-blur">
              <span className="h-3.5 w-3.5 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
              正在刷新配额
            </div>
          </div>
        )}
      </div>

      {!insight.hasRealRateLimits && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          {account.rateLimitsError
            ? `官方配额读取失败：${account.rateLimitsError}`
            : "当前未拿到官方配额数据，不再展示估算值。"}
        </div>
      )}

      <div className="mt-3.5 flex items-center gap-1.5 text-[11px] text-slate-400">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <span>数据最后同步于: {insight.syncLabel}</span>
        <button
          onClick={() => void onRefresh()}
          disabled={isQuotaRefreshing}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={`刷新 ${account.displayName} 配额`}
        >
          <svg
            className={clsx("h-3 w-3", isQuotaRefreshing && "animate-spin")}
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

      <div className="mt-1 text-[10px] text-slate-400">
        最近切换 {formatRelativeTime(account.lastSwitchedAt)}
      </div>

      <div
        className={clsx(
          "mt-3 rounded-2xl border px-3 py-2.5",
          isActive
            ? "border-indigo-200 bg-indigo-50/80"
            : isSwitchTarget
            ? "border-amber-200 bg-amber-50/80"
            : "border-slate-200 bg-slate-50/80",
        )}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Account Status
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
              isActive
                ? "bg-indigo-100 text-indigo-700"
                : isSwitchTarget
                ? "bg-amber-100 text-amber-700"
                : "bg-white text-slate-600",
            )}
          >
            <span
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                isActive
                  ? "bg-indigo-500"
                  : isSwitchTarget
                  ? "bg-amber-500 animate-pulse"
                  : "bg-emerald-500",
              )}
            />
            {statusLabel}
          </div>
          <div
            className={clsx(
              "text-right text-[10px]",
              isActive
                ? "text-indigo-500"
                : isSwitchTarget
                ? "text-amber-600"
                : "text-slate-500",
            )}
          >
            {isActive
              ? "当前账号已写入 auth.json"
              : isSwitchTarget
              ? "正在切换共享会话的账号凭证"
              : "切换后继续当前共享会话"}
          </div>
        </div>
      </div>

      <div className="my-3.5 h-px bg-slate-100" />

      <div className="flex items-center gap-3">
        <button
          onClick={() => !isActive && onSwitch(account)}
          disabled={isActive || isSwitching}
          className={clsx(
            "flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed",
            isActive
              ? "border border-indigo-100 bg-indigo-50 text-indigo-500 shadow-none"
              : "bg-slate-900 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-800/70",
          )}
        >
          {isActive ? "正在使用中" : isSwitchTarget ? "切换中..." : "切换到此账户"}
        </button>

        <button
          onClick={() => onDelete(account.id)}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-slate-100 hover:text-red-500"
          aria-label={`删除 ${account.displayName}`}
        >
          <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M6 7h12m-9 0V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v11m4-11v11m5-11v11a2 2 0 01-2 2H8a2 2 0 01-2-2V7h12z"
            />
          </svg>
        </button>
      </div>
    </article>
  );
};

export default AccountCard;
