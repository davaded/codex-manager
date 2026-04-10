import React, { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useAccountStore } from "../store/accountStore";
import {
  formatRelativeTime,
  getAccountStatusReason,
  getAccountInsight,
  getBestQuotaAccount,
  getHourlyUsageEfficiency,
  getRecommendedAccountId,
  isAccountInvalid,
} from "../utils/dashboard";
import { api } from "../utils/invoke";
import type { Account, UsageStatsSummary } from "../types";
import { hoverLift, revealUp } from "../utils/motion";
import { getAccountTokenUsage } from "../utils/tokenLedger";

interface UsageStatsPageProps {
  isRefreshing: boolean;
  onRefreshUsage: () => Promise<void>;
}

function formatRemainingPercent(usedPercent: number | null | undefined): string {
  if (typeof usedPercent !== "number") {
    return "--";
  }

  return `${Math.max(0, 100 - Math.round(usedPercent))}%`;
}

function formatTokenNumber(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "--";
  }
  return value.toLocaleString("zh-CN");
}

function efficiencyTone(status: ReturnType<typeof getHourlyUsageEfficiency>["status"]): string {
  switch (status) {
    case "balanced":
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "aggressive":
      return "text-rose-700 bg-rose-50 border-rose-200";
    case "underused":
      return "text-amber-700 bg-amber-50 border-amber-200";
    default:
      return "text-slate-500 bg-slate-50 border-slate-200";
  }
}

function efficiencySummaryLabel(score: number | null): string {
  if (score === null) {
    return "待同步";
  }
  if (score >= 85) {
    return "稳定";
  }
  if (score >= 60) {
    return "可控";
  }
  return "偏离";
}

function efficiencyStatusText(status: ReturnType<typeof getHourlyUsageEfficiency>["status"]): string {
  switch (status) {
    case "balanced":
      return "平衡";
    case "aggressive":
      return "偏高";
    case "underused":
      return "偏慢";
    default:
      return "待同步";
  }
}

function describeAction(account: Account, recommendedId: string | null): string {
  if (isAccountInvalid(account)) {
    return "跳过";
  }
  if (account.isActive && account.id === recommendedId) {
    return "继续";
  }
  if (account.id === recommendedId) {
    return "切换";
  }
  if (account.isActive) {
    return "观察";
  }
  return "待命";
}

function formatAccountSessionToken(
  account: Account,
  usageStats: UsageStatsSummary | null,
): string {
  const usage = getAccountTokenUsage(account, usageStats?.latestTotalTokens);
  return usage.totalTokens > 0 ? formatTokenNumber(usage.totalTokens) : "--";
}

function formatAccountSessionModel(
  account: Account,
  usageStats: UsageStatsSummary | null,
): string {
  if (!account.isActive) {
    return "--";
  }

  return usageStats?.latestModel ?? "--";
}

const UsageStatsPage: React.FC<UsageStatsPageProps> = ({
  isRefreshing,
  onRefreshUsage,
}) => {
  const { accounts, setAddModalOpen } = useAccountStore();
  const prefersReducedMotion = useReducedMotion() ?? false;
  const [usageStats, setUsageStats] = useState<UsageStatsSummary | null>(null);

  const refreshSummary = async () => {
    try {
      const summary = await api.readUsageStatsSummary();
      setUsageStats(summary);
    } catch {
      setUsageStats(null);
    }
  };

  const handleRefreshStats = async () => {
    await onRefreshUsage();
    await refreshSummary();
  };

  useEffect(() => {
    let cancelled = false;
    const syncSummary = async () => {
      try {
        const summary = await api.readUsageStatsSummary();
        if (!cancelled) {
          setUsageStats(summary);
        }
      } catch {
        if (!cancelled) {
          setUsageStats(null);
        }
      }
    };

    const handleWindowFocus = () => {
      void syncSummary();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncSummary();
      }
    };

    void syncSummary();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void syncSummary();
      }
    }, 2000);

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [accounts]);

  if (accounts.length === 0) {
    return (
      <section className="mx-auto w-full max-w-[1480px]">
        <motion.div
          className="apple-panel rounded-[34px] px-8 py-20 text-center"
          {...revealUp(prefersReducedMotion, 0.04)}
        >
          <span className="eyebrow-chip">Usage</span>
          <h2 className="mx-auto mt-5 max-w-3xl text-[2.2rem] font-black tracking-[-0.07em] text-slate-950 sm:text-[2.8rem]">
            先接入账户，再看统计
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-8 text-slate-600">
            这里会显示当前压力、模型分布和下一位候选。
          </p>
          <button
            onClick={() => setAddModalOpen(true)}
            className="primary-action mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white"
          >
            添加第一个账户
          </button>
        </motion.div>
      </section>
    );
  }

  const now = Date.now();
  const sortedAccounts = [...accounts].sort((left, right) => {
    const leftPrimary = left.rateLimits?.primary?.usedPercent ?? Number.POSITIVE_INFINITY;
    const rightPrimary = right.rateLimits?.primary?.usedPercent ?? Number.POSITIVE_INFINITY;
    if (left.isActive) return -1;
    if (right.isActive) return 1;
    if (leftPrimary !== rightPrimary) {
      return leftPrimary - rightPrimary;
    }
    return left.displayName.localeCompare(right.displayName, "zh-CN");
  });

  const activeAccount = sortedAccounts.find((account) => account.isActive) ?? null;
  const bestAccount = getBestQuotaAccount(sortedAccounts);
  const recommendedId = getRecommendedAccountId(sortedAccounts);
  const invalidAccountsCount = sortedAccounts.filter((account) => isAccountInvalid(account)).length;
  const efficiencyRows = sortedAccounts.map((account) => ({
    account,
    efficiency: getHourlyUsageEfficiency(account, now),
  }));

  const efficiencyValues = efficiencyRows
    .map((row) => row.efficiency.score)
    .filter((value): value is number => typeof value === "number");
  const averageEfficiency =
    efficiencyValues.length > 0
      ? Math.round(
          efficiencyValues.reduce((sum, value) => sum + value, 0) / efficiencyValues.length,
        )
      : null;
  const mostUnderused = [...efficiencyRows]
    .filter((row) => typeof row.efficiency.score === "number")
    .sort((left, right) => (left.efficiency.score ?? 0) - (right.efficiency.score ?? 0))[0];
  const hottestAccount = [...sortedAccounts].sort((left, right) => {
    const leftUsage = left.rateLimits?.primary?.usedPercent ?? -1;
    const rightUsage = right.rateLimits?.primary?.usedPercent ?? -1;
    return rightUsage - leftUsage;
  })[0];
  const bestInsight = bestAccount ? getAccountInsight(bestAccount) : null;
  const activeInsight = activeAccount ? getAccountInsight(activeAccount) : null;
  const averageEfficiencyLabel = efficiencySummaryLabel(averageEfficiency);
  const averageEfficiencyBarWidth = averageEfficiency === null ? 24 : Math.max(12, averageEfficiency);
  const currentDecisionLabel =
    invalidAccountsCount > 0
      ? "先处理失效账号"
      : !bestAccount
        ? "等待刷新"
        : bestAccount.isActive || bestAccount.id === activeAccount?.id
          ? "继续维持"
          : "建议切换";
  const currentDecisionDetail =
    invalidAccountsCount > 0
      ? `${invalidAccountsCount} 个账号需要重新登录`
      : activeAccount
        ? `最近切换 ${formatRelativeTime(activeAccount.lastSwitchedAt)}`
        : "未匹配当前授权";
  const handoffHeadline =
    !bestAccount
      ? "暂无建议"
      : bestAccount.isActive || bestAccount.id === activeAccount?.id
        ? "暂无更优"
        : bestAccount.displayName;
  const handoffLabel =
    !bestAccount
      ? "等待刷新"
      : bestAccount.isActive || bestAccount.id === activeAccount?.id
        ? "无需切换"
        : "优先接手";

  return (
    <section className="mx-auto w-full max-w-[1480px] space-y-4">
      <motion.div
        className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"
        {...revealUp(prefersReducedMotion, 0.02)}
      >
        <div className="max-w-xl">
          <span className="eyebrow-chip">Overview</span>
          <h2 className="mt-3 text-[1.8rem] font-black tracking-[-0.07em] text-slate-950 sm:text-[2.15rem]">
            调度判断
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-dashed border-[#dad4c8] bg-white/60 px-3.5 py-2 text-[13px] font-medium text-slate-600">
            队列状态 · {averageEfficiencyLabel}
          </span>
        </div>
      </motion.div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_290px]">
        <motion.article
          className="relative overflow-hidden rounded-[34px] border border-[#dad4c8] bg-[linear-gradient(135deg,#fffdf9_0%,#fff7ec_40%,#b8efc7_100%)] px-5 py-5 text-slate-950 shadow-[rgba(0,0,0,0.1)_0px_1px_1px,rgba(0,0,0,0.04)_0px_-1px_1px_inset,rgba(0,0,0,0.05)_0px_-0.5px_1px,rgba(80,62,30,0.16)_0px_26px_50px_-30px] sm:px-6"
          {...revealUp(prefersReducedMotion, 0.04)}
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.72),transparent_66%)]" />
            <div className="absolute -right-16 top-8 h-52 w-52 rounded-full bg-[#3bd3fd]/22 blur-3xl" />
            <div className="absolute -left-10 bottom-4 h-48 w-48 rounded-full bg-[#fc7981]/14 blur-3xl" />
          </div>

          <div className="relative flex flex-col gap-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                  Recommendation
                </span>
                <div className="mt-3 flex flex-wrap items-center gap-2.5">
                  <h3 className="truncate text-[1.82rem] font-black tracking-[-0.06em] text-slate-950 sm:text-[2.05rem]">
                    {bestAccount?.displayName ?? (invalidAccountsCount > 0 ? "暂无可用账号" : "暂无建议")}
                  </h3>
                  <span className="rounded-full border border-dashed border-[#e2dccf] bg-white/46 px-3 py-1 text-[10px] font-semibold text-[#6b675f]">
                    {bestAccount
                      ? bestAccount.isActive
                        ? "当前最优"
                        : "建议切换"
                      : invalidAccountsCount > 0
                        ? "需要处理"
                        : "等待刷新"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#55534e]">
                  {bestInsight?.hourlyQuota.valueLabel && (
                    <span className="rounded-full border border-dashed border-[#dad4c8] bg-white/60 px-2.5 py-1 text-[11px] font-medium text-[#55534e]">
                      5H {bestInsight.hourlyQuota.valueLabel}
                    </span>
                  )}
                  {invalidAccountsCount > 0 && (
                    <span className="rounded-full border border-dashed border-[#ead2cf] bg-white/60 px-2.5 py-1 text-[11px] font-medium text-[#8a4a45]">
                      失效 {invalidAccountsCount}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => void handleRefreshStats()}
                disabled={isRefreshing}
                className="inline-flex items-center gap-2 rounded-full border border-dashed border-[#bcd8c6] bg-white/74 px-3.5 py-2.5 text-[13px] font-semibold text-emerald-700 shadow-[rgba(0,0,0,0.08)_0px_1px_1px,rgba(0,0,0,0.04)_0px_-1px_1px_inset] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_28px_-24px_rgba(16,185,129,0.3)] disabled:opacity-60"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                {isRefreshing ? "刷新中..." : "刷新统计"}
              </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.14fr)_300px]">
              <div className="rounded-[28px] border border-[#e2dccf] bg-white/58 px-5 py-5 shadow-[rgba(255,255,255,0.35)_0px_1px_0px_inset,rgba(80,62,30,0.08)_0px_22px_40px_-34px] backdrop-blur-sm">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,0.88fr)] lg:items-start">
                  <section className="min-w-0 px-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                          5H 效率
                        </p>
                        <div className="mt-4">
                          <p className="text-[3.35rem] leading-none font-black tracking-[-0.1em] text-slate-950 sm:text-[3.65rem]">
                            {averageEfficiency === null ? "--" : `${averageEfficiency}%`}
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full border border-dashed border-[#e2dccf] bg-white/48 px-3 py-1.5 text-[10px] font-semibold tracking-[0.18em] text-[#6b675f]">
                        {averageEfficiencyLabel}
                      </span>
                    </div>
                    <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-[#e8e2d8]">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#84e7a5_0%,#3bd3fd_100%)] transition-all"
                        style={{ width: `${averageEfficiencyBarWidth}%` }}
                      />
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] font-medium text-slate-500">
                      <span>队列节奏</span>
                      <span>{averageEfficiency === null ? "等待统计" : "目标 100%"}</span>
                    </div>
                  </section>

                  <div className="hidden h-full w-px bg-[linear-gradient(180deg,rgba(218,212,200,0),rgba(218,212,200,0.9),rgba(218,212,200,0))] lg:block" />

                  <section className="min-w-0 px-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                      接力观察
                    </p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          最空闲
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <p className="text-[1.32rem] font-black tracking-[-0.05em] text-slate-950">
                            {mostUnderused?.account.displayName ?? "暂无数据"}
                          </p>
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${efficiencyTone(
                              mostUnderused?.efficiency.status ?? "unavailable",
                            )}`}
                          >
                            {efficiencyStatusText(mostUnderused?.efficiency.status ?? "unavailable")}
                          </span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          当前最热
                        </p>
                        <p className="mt-2 text-[1.18rem] font-black tracking-[-0.04em] text-slate-950">
                          {hottestAccount?.displayName ?? "暂无数据"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          5H 剩余 {formatRemainingPercent(hottestAccount?.rateLimits?.primary?.usedPercent)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          当前主模型
                        </p>
                        <p className="mt-2 text-[1.18rem] font-black tracking-[-0.04em] text-slate-950">
                          {usageStats?.latestModel ?? "--"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          累计 Token
                        </p>
                        <p className="mt-2 text-[1.18rem] font-black tracking-[-0.04em] text-slate-950">
                          {usageStats ? formatTokenNumber(usageStats.totalTokens.totalTokens) : "--"}
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              <div className="rounded-[26px] border border-dashed border-[#dad4c8] bg-white/78 px-4 py-4 shadow-[rgba(255,255,255,0.35)_0px_1px_0px_inset]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  当前判断
                </p>
                <div className="mt-3 space-y-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      当前判断
                    </p>
                    <p className="mt-2 text-[1.2rem] font-black tracking-[-0.05em] text-slate-950">
                      {currentDecisionLabel}
                    </p>
                    <p className="mt-1 text-sm text-[#55534e]">
                      {currentDecisionDetail}
                    </p>
                  </div>

                  <div className="border-t border-dashed border-[#dad4c8] pt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      最佳接手
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="text-[1.2rem] font-black tracking-[-0.05em] text-slate-950">
                        {handoffHeadline}
                      </p>
                      <span
                        className={`rounded-full border border-dashed px-2.5 py-1 text-[11px] font-semibold ${
                          handoffLabel === "无需切换"
                            ? "border-[#dad4c8] bg-white/72 text-slate-600"
                            : "border-[#cbe7d4] bg-emerald-50/78 text-emerald-700"
                        }`}
                      >
                        {handoffLabel}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border border-dashed border-[#dad4c8] bg-white/82 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                        5H {bestInsight?.hourlyQuota.valueLabel ?? "--"}
                      </span>
                      <span className="rounded-full border border-dashed border-[#dad4c8] bg-white/82 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                        本周 {bestInsight?.weeklyQuota.valueLabel ?? "--"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 border-t border-dashed border-[#dad4c8] pt-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        最近一轮
                      </p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-950">
                        {usageStats?.latestTotalTokens
                          ? formatTokenNumber(usageStats.latestTotalTokens.totalTokens)
                          : "--"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        模型数
                      </p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-950">
                        {usageStats?.models.length ?? 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        当前 5H
                      </p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-950">
                        {activeInsight?.hourlyQuota.valueLabel ?? "--"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        当前本周
                      </p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-950">
                        {activeInsight?.weeklyQuota.valueLabel ?? "--"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.article>

        <motion.aside
          className="apple-panel-muted rounded-[30px] p-5"
          {...revealUp(prefersReducedMotion, 0.08)}
          whileHover={hoverLift(prefersReducedMotion)}
        >
          <p className="section-kicker">Models</p>
          <div className="mt-4 space-y-4">
            {usageStats?.models.length ? (
              usageStats.models.slice(0, 4).map((model, index) => {
                const ratio =
                  usageStats.totalTokens.totalTokens > 0
                    ? (model.totalTokens / usageStats.totalTokens.totalTokens) * 100
                    : 0;
                return (
                  <div key={model.model}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-700">
                          {index + 1}
                        </span>
                        <div>
                          <p className="font-semibold text-slate-950">{model.model}</p>
                          <p className="text-xs text-slate-500">{model.sessions} 个会话</p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-slate-600">
                        {Math.round(ratio)}%
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#111827,#768392)]"
                        style={{ width: `${Math.max(ratio, 6)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-slate-500">当前还没有模型分布数据。</p>
            )}
          </div>
        </motion.aside>
      </div>

      <motion.section
        className="apple-panel rounded-[32px] p-5 sm:p-5.5"
        {...revealUp(prefersReducedMotion, 0.14)}
      >
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200/80 pb-4">
          <div>
            <p className="section-kicker">Matrix</p>
            <h3 className="mt-2 text-[1.45rem] font-black tracking-[-0.05em] text-slate-950">
              调度矩阵
            </h3>
          </div>
        </div>

        <div className="mt-5 space-y-2.5">
          {efficiencyRows.map(({ account, efficiency }, index) => {
            const insight = getAccountInsight(account);
            const isInvalid = isAccountInvalid(account);

            return (
              <motion.div
                key={account.id}
                className="rounded-[24px] border border-[#e6e0d5] bg-white/78 px-4 py-4"
                {...revealUp(prefersReducedMotion, 0.02 * index)}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-[1.05rem] font-bold tracking-[-0.03em] text-slate-950">
                        {account.displayName}
                      </h4>
                      {account.isActive && (
                        <span className="rounded-full border border-dashed border-indigo-200 bg-indigo-50/85 px-2.5 py-1 text-[10px] font-semibold text-indigo-700">
                          当前
                        </span>
                      )}
                      {isInvalid && (
                        <span className="rounded-full border border-dashed border-rose-200 bg-rose-50/85 px-2.5 py-1 text-[10px] font-semibold text-rose-700">
                          失效
                        </span>
                      )}
                      {account.id === recommendedId && !account.isActive && !isInvalid && (
                        <span className="rounded-full border border-dashed border-emerald-200 bg-emerald-50/85 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                          推荐
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm text-slate-500">
                      {account.email ?? account.userId ?? "未识别身份"}
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3 lg:min-w-[320px]">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        5H
                      </p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-950">
                        {insight.hourlyQuota.valueLabel}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        本周
                      </p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-950">
                        {insight.weeklyQuota.valueLabel}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        建议
                      </p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-950">
                        {describeAction(account, recommendedId)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2.5 border-t border-dashed border-[#e6e0d5] pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold ${efficiencyTone(
                        efficiency.status,
                      )}`}
                    >
                      效率 {efficiency.label}
                    </span>
                    <span className="text-xs text-slate-500">
                      {isInvalid
                        ? getAccountStatusReason(account) ?? "账号已失效或不可用"
                        : efficiency.detail}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span>模型 {formatAccountSessionModel(account, usageStats)}</span>
                    <span>Token {formatAccountSessionToken(account, usageStats)}</span>
                    <span>最近切换 {formatRelativeTime(account.lastSwitchedAt)}</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.section>
    </section>
  );
};

export default UsageStatsPage;
