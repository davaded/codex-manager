import { describe, expect, it } from "vitest";
import type { Account, UsageStatsSummary } from "../src/types";
import {
  estimateTokenSpendUsd,
  formatUsdEstimate,
  getAccountQuotaUsdEstimate,
} from "../src/utils/quotaValue";

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "account-1",
    displayName: "Work",
    email: "dev@example.com",
    userId: "user-1",
    isActive: true,
    createdAt: "2026-03-01T00:00:00Z",
    lastSwitchedAt: "2026-03-10T10:00:00Z",
    sessionInfo: null,
    rateLimits: {
      primary: { remainingPercent: 80 },
      secondary: { remainingPercent: 50 },
    },
    rateLimitsError: null,
    usageLedger: null,
    ...overrides,
  };
}

const usageStats: UsageStatsSummary = {
  sessionsAnalyzed: 1,
  latestModel: "gpt-5-codex",
  totalTokens: {
    inputTokens: 100_000,
    cachedInputTokens: 20_000,
    outputTokens: 10_000,
    reasoningOutputTokens: 5_000,
    totalTokens: 110_000,
  },
  latestTotalTokens: {
    inputTokens: 100_000,
    cachedInputTokens: 20_000,
    outputTokens: 10_000,
    reasoningOutputTokens: 5_000,
    totalTokens: 110_000,
  },
  models: [{ model: "gpt-5-codex", sessions: 1, totalTokens: 110_000 }],
};

describe("quota value estimates", () => {
  it("estimates token spend with cached input pricing", () => {
    const spent = estimateTokenSpendUsd(usageStats.totalTokens, "gpt-5-codex");

    expect(spent).toBeCloseTo(0.2835, 6);
  });

  it("projects hourly and weekly USD limits from remaining quota", () => {
    const estimate = getAccountQuotaUsdEstimate(createAccount(), usageStats);

    expect(estimate?.spentUsd).toBeCloseTo(0.2835, 6);
    expect(estimate?.hourlyLimitUsd).toBeCloseTo(1.4175, 6);
    expect(estimate?.weeklyLimitUsd).toBeCloseTo(0.567, 6);
  });

  it("does not project a limit when quota usage is still zero", () => {
    const estimate = getAccountQuotaUsdEstimate(
      createAccount({
        rateLimits: {
          primary: { remainingPercent: 100 },
          secondary: { remainingPercent: 100 },
        },
      }),
      usageStats,
    );

    expect(estimate?.hourlyLimitUsd).toBeNull();
    expect(estimate?.weeklyLimitUsd).toBeNull();
  });

  it("formats tiny and normal USD values", () => {
    expect(formatUsdEstimate(0.004)).toBe("<$0.01");
    expect(formatUsdEstimate(1.235)).toBe("$1.24");
    expect(formatUsdEstimate(null)).toBe("--");
  });
});
