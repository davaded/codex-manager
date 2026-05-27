import React, { Suspense, useEffect, useState } from "react";
import { clsx } from "clsx";
import { motion, useReducedMotion } from "motion/react";
import { Account } from "../types";
import { useAccountStore } from "../store/accountStore";
import {
  formatRelativeTime,
  getAccountInsight,
  getAccountStatusReason,
  isAccountInvalid,
} from "../utils/dashboard";
import { hoverLift } from "../utils/motion";

const UsageChart = React.lazy(() => import("./UsageChart"));

interface AccountCardProps {
  account: Account;
  isRecommended: boolean;
  isRefreshing: boolean;
  isRefreshingSelf: boolean;
  variant?: "default" | "featured" | "compact";
  onDelete: (id: string) => void;
  onRefresh: () => Promise<void>;
  onRename: (id: string, displayName: string) => Promise<void>;
  onSwitch: (account: Account) => void;
}

const ROLE_STYLES = {
  plus: "border-violet-100 bg-violet-50/85 text-violet-700",
  pro: "border-amber-100 bg-amber-50/85 text-amber-700",
  team: "border-sky-100 bg-sky-50/85 text-sky-700",
  enterprise: "border-slate-200 bg-slate-100/90 text-slate-700",
  business: "border-cyan-100 bg-cyan-50/85 text-cyan-700",
  free: "border-emerald-100 bg-emerald-50/85 text-emerald-700",
  unknown: "border-slate-200 bg-slate-50/85 text-slate-600",
  invalid: "border-rose-100 bg-rose-50/90 text-rose-700",
} as const;

const AccountCard: React.FC<AccountCardProps> = ({
  account,
  isRecommended,
  isRefreshing,
  isRefreshingSelf,
  variant = "default",
  onDelete,
  onRefresh,
  onRename,
  onSwitch,
}) => {
  const { switchState } = useAccountStore();
  const prefersReducedMotion = useReducedMotion() ?? false;
  const insight = getAccountInsight(account);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(account.displayName);
  const [isSavingName, setIsSavingName] = useState(false);

  const isSwitching = switchState.phase !== "idle";
  const isActive = account.isActive;
  const isFeatured = variant === "featured";
  const isCompact = variant === "compact";
  const isSwitchTarget = switchState.toAccountId === account.id && isSwitching;
  const isQuotaRefreshing = isRefreshing || isRefreshingSelf;
  const isInvalid = isAccountInvalid(account);
  const switchDisabled = isActive || isSwitching || isInvalid;
  const statusLabel = isInvalid
    ? isActive
      ? "当前已失效"
      : "已失效"
    : isActive
      ? "当前"
      : isSwitchTarget
        ? "切换中"
        : "待命";
  const invalidReason = getAccountStatusReason(account);
  const renderCompactQuota = (metric: typeof insight.hourlyQuota) => (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {metric.label.startsWith("5") ? "5h" : "Week"}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-950">
        {typeof metric.percent === "number" ? `${Math.round(metric.percent)}%` : metric.valueLabel}
      </div>
      <div className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
        {metric.resetLabel ? `重置 ${metric.resetLabel}` : metric.detail}
      </div>
    </div>
  );

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

  if (isCompact) {
    return (
      <motion.article
        layout
        className="apple-panel grid gap-4 rounded-[28px] px-5 py-4 lg:grid-cols-[minmax(0,1fr)_390px_172px] lg:items-center"
        whileHover={hoverLift(prefersReducedMotion)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="group flex min-w-0 items-center gap-1.5">
              <h3 className="truncate text-[1.05rem] font-semibold tracking-[-0.03em] text-slate-950">
                {account.displayName}
              </h3>
              <button
                onClick={() => {
                  setDraftName(account.displayName);
                  setIsEditing(true);
                }}
                className="rounded-full p-1.5 text-slate-300 opacity-0 transition-all hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100"
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
            {isActive && !isInvalid && (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700">
                当前
              </span>
            )}
            {isInvalid && (
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-700">
                失效
              </span>
            )}
            {isRecommended && !isActive && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                推荐
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{account.email ?? account.userId ?? "未绑定邮箱"}</span>
            <span>·</span>
            <span>{statusLabel}</span>
            <span>·</span>
            <span>最近切换 {formatRelativeTime(account.lastSwitchedAt)}</span>
          </div>
        </div>

        <div className="grid grid-cols-[58px_minmax(132px,1fr)] gap-x-4 gap-y-3 lg:grid-cols-[58px_minmax(132px,1fr)_84px] lg:gap-x-4">
          {renderCompactQuota(insight.hourlyQuota)}
          {renderCompactQuota(insight.weeklyQuota)}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Sync
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-950">
              {insight.syncLabel}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-start gap-2 lg:justify-end">
          <button
            onClick={() => void onRefresh()}
            disabled={isQuotaRefreshing}
            className="glass-pill rounded-full px-3 py-2 text-xs font-semibold text-slate-600 transition-all hover:bg-white/80 hover:text-slate-950 disabled:opacity-60"
          >
            {isQuotaRefreshing ? "刷新中" : "刷新"}
          </button>
          <button
            onClick={() => !switchDisabled && onSwitch(account)}
            disabled={switchDisabled}
            className={clsx(
              "rounded-full px-4 py-2 text-xs font-semibold transition-all disabled:cursor-not-allowed",
              isInvalid
                ? "border border-rose-100 bg-rose-50 text-rose-600 disabled:bg-rose-50"
                : isActive
                  ? "border border-sky-100 bg-sky-50 text-sky-600"
                  : "bg-slate-950 text-white hover:-translate-y-0.5 disabled:bg-slate-800/70",
            )}
          >
            {isInvalid ? "账号失效" : isActive ? "当前使用中" : isSwitchTarget ? "切换中" : "切换"}
          </button>
          <button
            onClick={() => onDelete(account.id)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/72 text-slate-400 transition-all hover:bg-white hover:text-red-500"
            aria-label={`删除 ${account.displayName}`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M6 7h12m-9 0V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v11m4-11v11m5-11v11a2 2 0 01-2 2H8a2 2 0 01-2-2V7h12z"
              />
            </svg>
          </button>
        </div>

        {isEditing && (
          <div className="w-full rounded-[22px] border border-slate-200 bg-white/88 p-3 lg:order-first lg:basis-full">
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
                className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-950 outline-none ring-0 focus:border-sky-300"
                autoFocus
              />
              <button
                onClick={() => void handleSaveName()}
                disabled={isSavingName}
                className="rounded-full bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                保存
              </button>
            </div>
          </div>
        )}
      </motion.article>
    );
  }

  if (isFeatured) {
    return (
      <motion.article
        layout
        className={clsx(
          "apple-panel relative overflow-hidden rounded-[32px] p-4 sm:p-5",
          isActive
            ? "border border-sky-200/80 shadow-[0_32px_80px_-52px_rgba(59,130,246,0.22)]"
            : "border border-white/72",
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.92),transparent_74%)]" />
        <div className="relative grid gap-3 lg:grid-cols-[minmax(0,1.18fr)_minmax(300px,0.82fr)]">
          <div className="rounded-[28px] bg-[linear-gradient(145deg,#0b1220_0%,#122238_54%,#203652_100%)] p-6 text-white shadow-[0_34px_76px_-50px_rgba(15,23,42,0.76)]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-400">
              Current
            </span>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <h3 className="truncate text-[2rem] font-black tracking-[-0.06em] text-white">
                {account.displayName}
              </h3>
              {isActive && !isInvalid && (
                <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1 text-[10px] font-semibold text-sky-100">
                  当前
                </span>
              )}
              {isInvalid && (
                <span className="rounded-full border border-rose-200/50 bg-rose-500/14 px-3 py-1 text-[10px] font-semibold text-rose-100">
                  失效
                </span>
              )}
              {isRecommended && !isActive && (
                <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1 text-[10px] font-semibold text-emerald-100">
                  下一位
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-300">
              <span
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-[11px] font-medium text-white",
                )}
              >
                {insight.roleLabel}
              </span>
              <span className="truncate text-slate-300">{account.email ?? account.userId ?? "未绑定邮箱"}</span>
            </div>

            <div className="mt-10">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                5h 剩余
              </p>
              <div className="mt-3 flex items-end gap-3">
                <p className="text-[4rem] font-black tracking-[-0.11em] text-white">
                  {insight.hourlyQuota.valueLabel.split(" ")[0] ?? insight.hourlyQuota.valueLabel}
                </p>
                <span className="pb-3 text-sm text-slate-300">{insight.hourlyQuota.valueLabel.split(" ").slice(1).join(" ")}</span>
              </div>
              <p className="mt-2 text-sm text-slate-300">{insight.hourlyQuota.detail}</p>
            </div>

            <div className="mt-8 flex items-center gap-3">
              <button
                onClick={() => !switchDisabled && onSwitch(account)}
                disabled={switchDisabled}
                className={clsx(
                  "flex-1 rounded-full px-4 py-3 text-sm font-semibold transition-all disabled:cursor-not-allowed",
                  isInvalid
                    ? "border border-rose-200/50 bg-rose-500/14 text-rose-50 disabled:bg-rose-500/14"
                    : isActive
                      ? "border border-white/12 bg-white/10 text-white"
                      : "bg-white text-slate-950 shadow-[0_18px_32px_-24px_rgba(255,255,255,0.7)] disabled:bg-white/50",
                )}
              >
                {isInvalid ? "账号失效" : isActive ? "当前使用中" : isSwitchTarget ? "切换中..." : "切换到此账号"}
              </button>
              <button
                onClick={() => void onRefresh()}
                disabled={isQuotaRefreshing}
                className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/8 px-3 py-3 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/12 disabled:opacity-60"
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
          </div>

          <div className="grid gap-3">
            <div className="metric-tile rounded-[26px] px-5 py-5">
              <p className="section-kicker">本周</p>
              <p className="mt-2 text-[1.6rem] font-black tracking-[-0.05em] text-slate-950">
                {insight.weeklyQuota.valueLabel}
              </p>
              <p className="mt-1 text-xs text-slate-500">{insight.weeklyQuota.detail}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="metric-tile rounded-[24px] px-4 py-4">
                <p className="section-kicker">状态</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={clsx(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      isInvalid
                        ? "bg-rose-100 text-rose-700"
                        : isActive
                          ? "bg-sky-100 text-sky-700"
                          : isSwitchTarget
                            ? "bg-amber-100 text-amber-700"
                            : "bg-white text-slate-600",
                    )}
                  >
                    <span
                      className={clsx(
                        "h-1.5 w-1.5 rounded-full",
                        isInvalid
                          ? "bg-rose-500"
                          : isActive
                            ? "bg-sky-500"
                            : isSwitchTarget
                              ? "bg-amber-500 animate-pulse"
                              : "bg-emerald-500",
                      )}
                    />
                    {statusLabel}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">最近更新 {insight.syncLabel}</p>
              </div>
              <div className="metric-tile rounded-[24px] px-4 py-4">
                <p className="section-kicker">上次切换</p>
                <p className="mt-2 text-xl font-bold tracking-[-0.04em] text-slate-950">
                  {formatRelativeTime(account.lastSwitchedAt)}
                </p>
              </div>
            </div>

            {!insight.hasRealRateLimits && (
              <div
                className={clsx(
                  "rounded-[20px] px-3 py-2.5 text-[11px]",
                  isInvalid
                    ? "border border-rose-200 bg-rose-50/90 text-rose-700"
                    : "border border-amber-200 bg-amber-50/90 text-amber-700",
                )}
              >
                {isInvalid
                  ? `检测到账号失效 · ${invalidReason ?? "请重新登录该账号"}`
                  : account.rateLimitsError
                    ? `读取失败 · ${account.rateLimitsError}`
                    : "当前还没有官方配额数据。"}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                onClick={() => onDelete(account.id)}
                className="glass-pill rounded-full px-4 py-2.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-white hover:text-red-500"
                aria-label={`删除 ${account.displayName}`}
              >
                删除
              </button>
              <span className="text-xs text-slate-500">最近更新 {insight.syncLabel}</span>
            </div>
          </div>
        </div>
      </motion.article>
    );
  }

  return (
    <motion.article
      layout
      className={clsx(
        "apple-panel relative w-full overflow-hidden rounded-[34px]",
        isFeatured ? "p-5.5 sm:p-6" : "p-5",
        isActive
          ? "border border-sky-200/80 shadow-[0_32px_80px_-52px_rgba(59,130,246,0.26)]"
          : "border border-white/72",
      )}
      whileHover={!isActive ? hoverLift(prefersReducedMotion) : undefined}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.88),transparent_72%)]" />
      {isFeatured && (
        <div className="pointer-events-none absolute right-[-3rem] top-[-2rem] h-44 w-44 rounded-full bg-sky-100/60 blur-3xl" />
      )}

      {isRecommended && !isActive && !isInvalid && (
        <div className="absolute right-5 top-5 rounded-full border border-emerald-200 bg-emerald-50/92 px-3 py-1 text-[10px] font-semibold text-emerald-700">
          下一位
        </div>
      )}

      <div className="relative flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          {isFeatured && <span className="eyebrow-chip">Current</span>}
          {isEditing ? (
            <div className={clsx("flex items-center gap-2", isFeatured && "mt-3")}>
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
                className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2 text-[1.05rem] font-semibold text-slate-950 outline-none ring-0 focus:border-sky-300"
                autoFocus
              />
              <button
                onClick={() => void handleSaveName()}
                disabled={isSavingName}
                className="rounded-full p-2 text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-50"
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
            <div className={clsx("group flex items-center gap-1.5", isFeatured && "mt-3")}>
              <h3
                className={clsx(
                  "truncate font-bold tracking-[-0.04em] text-slate-950",
                  isFeatured ? "text-[1.65rem] sm:text-[1.95rem]" : "text-[1.22rem]",
                )}
              >
                {account.displayName}
              </h3>
              <button
                onClick={() => {
                  setDraftName(account.displayName);
                  setIsEditing(true);
                }}
                className="rounded-full p-2 text-slate-300 opacity-0 transition-all hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100"
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
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
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
          </div>
        </div>

        {isActive && !isInvalid && (
          <div className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[10px] font-semibold text-sky-700">
            当前
          </div>
        )}
        {isInvalid && (
          <div className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[10px] font-semibold text-rose-700">
            失效
          </div>
        )}
      </div>

      <div className={clsx("relative", isFeatured ? "mt-5" : "mt-5")}>
        <div
          className={clsx(
            "grid gap-3 transition-opacity duration-200",
            isFeatured ? "md:grid-cols-2" : "grid-cols-2",
            isQuotaRefreshing && "opacity-45",
          )}
        >
          {[insight.hourlyQuota, insight.weeklyQuota].map((metric) => (
            <div
              key={metric.label}
              className="rounded-[26px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(248,250,252,0.72))] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]"
            >
              <Suspense
                fallback={
                  <div
                    className={clsx(
                      "mx-auto w-full rounded-2xl bg-slate-100/80",
                      isFeatured ? "h-[96px]" : "h-[96px]",
                    )}
                  />
                }
              >
                <UsageChart metric={metric} />
              </Suspense>
              <div className="mt-1 text-center">
                <div className="text-[11px] font-semibold tracking-[0.01em] text-slate-500">
                  {metric.label}
                </div>
                <div className="mt-1 text-[13px] font-semibold text-slate-950">
                  {metric.valueLabel}
                </div>
                <div className="mt-1 text-[10px] leading-4 text-sky-600">
                  {metric.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
        {isQuotaRefreshing && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[24px]">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/92 px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow-[0_12px_26px_-16px_rgba(15,23,42,0.18)] backdrop-blur">
              <span className="h-3.5 w-3.5 rounded-full border-2 border-slate-200 border-t-slate-800 animate-spin" />
              正在刷新配额
            </div>
          </div>
        )}
      </div>

      {!insight.hasRealRateLimits && (
        <div
          className={clsx(
            "mt-3 rounded-[22px] px-3 py-2.5 text-[11px]",
            isInvalid
              ? "border border-rose-200 bg-rose-50/90 text-rose-700"
              : "border border-amber-200 bg-amber-50/90 text-amber-700",
          )}
        >
          {isInvalid
            ? `检测到账号失效：${invalidReason ?? "请重新登录该账号"}`
            : account.rateLimitsError
              ? `官方配额读取失败：${account.rateLimitsError}`
              : "当前未拿到官方配额数据，不再展示估算值。"}
        </div>
      )}

      <div className={clsx("flex items-center gap-1.5 text-[11px] text-slate-400", isFeatured ? "mt-4" : "mt-4")}>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <span>最近更新 {insight.syncLabel}</span>
        <button
          onClick={() => void onRefresh()}
          disabled={isQuotaRefreshing}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
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

      <div className="mt-2 text-[10px] text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span>最近切换 {formatRelativeTime(account.lastSwitchedAt)}</span>
          <div
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
              isActive
                ? "bg-sky-100 text-sky-700"
                : isInvalid
                  ? "bg-rose-100 text-rose-700"
                : isSwitchTarget
                  ? "bg-amber-100 text-amber-700"
                  : "bg-white text-slate-600",
            )}
          >
            <span
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                isActive
                  ? "bg-sky-500"
                  : isInvalid
                    ? "bg-rose-500"
                  : isSwitchTarget
                    ? "bg-amber-500 animate-pulse"
                    : "bg-emerald-500",
              )}
            />
            {statusLabel}
          </div>
          <span
            className={clsx(
              "text-[10px]",
              isInvalid
                ? "text-rose-600"
                : isActive
                  ? "text-sky-600"
                  : isSwitchTarget
                    ? "text-amber-600"
                    : "text-slate-500",
            )}
          >
            {isInvalid
              ? "该账号已不再参与切换"
              : isActive
                ? "当前账号已写入 auth.json"
                : isSwitchTarget
                  ? "正在切换共享会话"
                  : "切换后继续当前会话"}
          </span>
        </div>
      </div>

      <div className={clsx("h-px bg-slate-200/80", isFeatured ? "my-4" : "my-4")} />

      <div className={clsx("flex items-center gap-3", isFeatured && "sm:max-w-[460px]")}>
        <button
          onClick={() => !switchDisabled && onSwitch(account)}
          disabled={switchDisabled}
          className={clsx(
            "flex-1 rounded-full px-4 py-3 text-sm font-semibold transition-all disabled:cursor-not-allowed",
            isInvalid
              ? "border border-rose-200 bg-rose-50 text-rose-600 shadow-none"
              : isActive
                ? "border border-sky-100 bg-sky-50 text-sky-600 shadow-none"
                : "primary-action text-white disabled:cursor-not-allowed disabled:bg-slate-800/70",
          )}
        >
          {isInvalid ? "账号失效" : isActive ? "当前使用中" : isSwitchTarget ? "切换中..." : "切换到此账号"}
        </button>

        <button
          onClick={() => onDelete(account.id)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/72 text-slate-400 transition-all hover:bg-white hover:text-red-500"
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
    </motion.article>
  );
};

export default AccountCard;
