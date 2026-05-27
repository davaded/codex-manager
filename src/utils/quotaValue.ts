import type { Account, TokenUsageInfo, UsageStatsSummary } from "../types";
import { getRemainingPercent } from "./dashboard";
import { getAccountTokenUsage } from "./tokenLedger";

type ModelTokenPrice = {
  input: number;
  cachedInput: number;
  output: number;
};

export type QuotaUsdEstimate = {
  model: string;
  spentUsd: number;
  hourlyLimitUsd: number | null;
  weeklyLimitUsd: number | null;
};

const PRICE_PER_1M_TOKENS: Record<string, ModelTokenPrice> = {
  "gpt-5.5-pro": { input: 30, cachedInput: 30, output: 180 },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.4-pro": { input: 30, cachedInput: 30, output: 180 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.3-codex": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.2-codex": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.2-pro": { input: 21, cachedInput: 21, output: 168 },
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5-codex": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5-pro": { input: 15, cachedInput: 15, output: 120 },
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
};

function normalizeModel(model: string | null | undefined): string | null {
  const normalized = model?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const exact = PRICE_PER_1M_TOKENS[normalized];
  if (exact) {
    return normalized;
  }

  const candidates = Object.keys(PRICE_PER_1M_TOKENS).sort((left, right) => right.length - left.length);
  return candidates.find((candidate) => normalized.startsWith(candidate)) ?? null;
}

export function estimateTokenSpendUsd(
  usage: TokenUsageInfo | null | undefined,
  model: string | null | undefined,
): number | null {
  const normalizedModel = normalizeModel(model);
  const price = normalizedModel ? PRICE_PER_1M_TOKENS[normalizedModel] : null;
  if (!usage || !price || usage.totalTokens <= 0) {
    return null;
  }

  const cachedInputTokens = Math.min(Math.max(usage.cachedInputTokens, 0), usage.inputTokens);
  const inputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0);
  const outputTokens =
    usage.outputTokens > 0 ? usage.outputTokens : Math.max(usage.totalTokens - usage.inputTokens, 0);

  return (
    (inputTokens / 1_000_000) * price.input +
    (cachedInputTokens / 1_000_000) * price.cachedInput +
    (outputTokens / 1_000_000) * price.output
  );
}

function estimateLimitUsd(spentUsd: number, remainingPercent: number | null): number | null {
  if (spentUsd <= 0 || remainingPercent === null) {
    return null;
  }

  const usedPercent = 100 - remainingPercent;
  if (usedPercent <= 0) {
    return null;
  }

  return spentUsd / (usedPercent / 100);
}

export function getDominantUsageModel(usageStats: UsageStatsSummary | null): string | null {
  if (usageStats?.latestModel) {
    return usageStats.latestModel;
  }

  return usageStats?.models[0]?.model ?? null;
}

export function getAccountQuotaUsdEstimate(
  account: Account,
  usageStats: UsageStatsSummary | null,
): QuotaUsdEstimate | null {
  const usage = getAccountTokenUsage(account, usageStats?.latestTotalTokens);
  const model = account.isActive ? usageStats?.latestModel : getDominantUsageModel(usageStats);
  const spentUsd = estimateTokenSpendUsd(usage, model);
  if (!model || spentUsd === null) {
    return null;
  }

  return {
    model,
    spentUsd,
    hourlyLimitUsd: estimateLimitUsd(spentUsd, getRemainingPercent(account.rateLimits?.primary)),
    weeklyLimitUsd: estimateLimitUsd(spentUsd, getRemainingPercent(account.rateLimits?.secondary)),
  };
}

export function formatUsdEstimate(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "--";
  }

  if (value < 0.01) {
    return "<$0.01";
  }

  if (value < 10) {
    return `$${value.toFixed(2)}`;
  }

  return `$${Math.round(value).toLocaleString("zh-CN")}`;
}
