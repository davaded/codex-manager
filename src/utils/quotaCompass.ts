import type {
  DailyWorkspaceUsage,
  DailyWorkspaceUsageBreakdown,
  DailyWorkspaceUsageTotals,
  RateLimitWindow,
  TokenUsageInfo,
} from "../types";
import { estimateTokenSpendUsd } from "./quotaValue";

export const USD_PER_CODEX_CREDIT = 40 / 1000;

export interface QuotaCompassStats {
  credits: number;
  turns: number;
  tokens: number;
  usd: number;
}

export interface QuotaCompassSummary {
  currentCycleList: DailyWorkspaceUsage[];
  historyList: DailyWorkspaceUsage[];
  currentStats: QuotaCompassStats;
  historyStats: QuotaCompassStats;
  usedPercent: number | null;
  estimatedTotalCredits: number | null;
  estimatedTotalUsd: number | null;
}

function numberOrZero(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function dayTime(date: string): number {
  const time = new Date(`${date}T00:00:00Z`).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function getDailyTokenTotal(totals: DailyWorkspaceUsageTotals | null | undefined): number {
  if (!totals) {
    return 0;
  }

  const explicitTotal = numberOrZero(totals.textTotalTokens);
  if (explicitTotal > 0) {
    return explicitTotal;
  }

  return (
    numberOrZero(totals.cachedTextInputTokens) +
    numberOrZero(totals.uncachedTextInputTokens) +
    numberOrZero(totals.textOutputTokens)
  );
}

function toTokenUsage(usage: DailyWorkspaceUsageTotals | DailyWorkspaceUsageBreakdown): TokenUsageInfo {
  const inputTokens =
    numberOrZero(usage.cachedTextInputTokens) + numberOrZero(usage.uncachedTextInputTokens);
  const outputTokens = numberOrZero(usage.textOutputTokens);
  const totalTokens = getDailyTokenTotal(usage);

  return {
    inputTokens,
    cachedInputTokens: numberOrZero(usage.cachedTextInputTokens),
    outputTokens,
    reasoningOutputTokens: 0,
    totalTokens: totalTokens > 0 ? totalTokens : inputTokens + outputTokens,
  };
}

function getDailyUsdTotal(day: DailyWorkspaceUsage): number {
  const creditedUsd = numberOrZero(day.totals?.credits) * USD_PER_CODEX_CREDIT;
  if (creditedUsd > 0) {
    return creditedUsd;
  }

  return (day.models ?? []).reduce((sum, modelUsage) => {
    const spentUsd = estimateTokenSpendUsd(toTokenUsage(modelUsage), modelUsage.model);
    return sum + numberOrZero(spentUsd);
  }, 0);
}

export function getQuotaCompassStats(list: DailyWorkspaceUsage[]): QuotaCompassStats {
  const totals = list.reduce(
    (sum, day) => ({
      credits: sum.credits + numberOrZero(day.totals?.credits),
      turns: sum.turns + numberOrZero(day.totals?.turns),
      tokens: sum.tokens + getDailyTokenTotal(day.totals),
      usd: sum.usd + getDailyUsdTotal(day),
    }),
    { credits: 0, turns: 0, tokens: 0, usd: 0 },
  );
  const credits = totals.credits > 0 ? totals.credits : totals.usd / USD_PER_CODEX_CREDIT;

  return {
    credits,
    turns: totals.turns,
    tokens: totals.tokens,
    usd: totals.usd,
  };
}

export function getWindowUsedPercent(window: RateLimitWindow | null | undefined): number | null {
  if (!window) {
    return null;
  }

  if (typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent)) {
    return Math.max(0, Math.min(100, window.usedPercent));
  }

  return Math.max(0, Math.min(100, 100 - window.remainingPercent));
}

export function getCycleStartDate(
  weeklyWindow: RateLimitWindow | null | undefined,
  fallbackStartDate: string,
): string {
  if (!weeklyWindow?.resetsAt || !weeklyWindow.windowDurationMins) {
    return fallbackStartDate;
  }

  return new Date((weeklyWindow.resetsAt - weeklyWindow.windowDurationMins * 60) * 1000)
    .toISOString()
    .split("T")[0];
}

export function buildQuotaCompassSummary(
  dailyList: DailyWorkspaceUsage[],
  cycleStartDate: string,
  weeklyWindow: RateLimitWindow | null | undefined,
): QuotaCompassSummary {
  const cycleStartTime = dayTime(cycleStartDate);
  const currentCycleList: DailyWorkspaceUsage[] = [];
  const historyList: DailyWorkspaceUsage[] = [];

  [...dailyList]
    .sort((left, right) => dayTime(left.date) - dayTime(right.date))
    .forEach((item) => {
      if (dayTime(item.date) >= cycleStartTime) {
        currentCycleList.push(item);
      } else {
        historyList.push(item);
      }
    });

  const currentStats = getQuotaCompassStats(currentCycleList);
  const historyStats = getQuotaCompassStats(historyList);
  const usedPercent = getWindowUsedPercent(weeklyWindow);
  const estimatedTotalCredits =
    usedPercent && usedPercent > 0 ? currentStats.credits / (usedPercent / 100) : null;
  const estimatedTotalUsd =
    usedPercent && usedPercent > 0 ? currentStats.usd / (usedPercent / 100) : null;

  return {
    currentCycleList,
    historyList,
    currentStats,
    historyStats,
    usedPercent,
    estimatedTotalCredits,
    estimatedTotalUsd,
  };
}

export function formatCompactTokenNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return value.toLocaleString("zh-CN");
}
