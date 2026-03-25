import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  getAccountInsight,
  getBestQuotaAccount,
  getRecommendedAccountId,
} from "../src/utils/dashboard";
import type { Account } from "../src/types";

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "account-1",
    displayName: "Work",
    email: "dev@example.com",
    userId: "user-1",
    isActive: false,
    createdAt: "2026-03-01T00:00:00",
    lastSwitchedAt: "2026-03-10T10:00:00",
    sessionInfo: {
      fileCount: 12,
      totalBytes: 1_024,
      lastSessionObservedAt: "2026-03-11T10:00:00",
      currentSessionId: null,
      currentThreadName: null,
      currentUpdatedAt: null,
    },
    rateLimits: null,
    rateLimitsError: null,
    ...overrides,
  };
}

describe("getAccountInsight", () => {
  it("derives plan, quota labels and sync source from rate limit data", () => {
    const account = createAccount({
      rateLimits: {
        planType: "pro",
        primary: { usedPercent: 92, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 44, resetsAt: 1_800_100_000 },
      },
    });

    const insight = getAccountInsight(account);

    expect(insight.roleLabel).toBe("Pro");
    expect(insight.hourlyQuota.valueLabel).toBe("92% / 5h");
    expect(insight.hourlyQuota.tone).toBe("critical");
    expect(insight.weeklyQuota.valueLabel).toBe("44% / week");
    expect(insight.weeklyQuota.tone).toBe("healthy");
    expect(insight.syncLabel).toBe("2026-03-11 10:00");
    expect(insight.hasRealRateLimits).toBe(true);
  });

  it("shows active accounts as realtime and handles missing quota data", () => {
    const account = createAccount({
      isActive: true,
      rateLimits: null,
      lastSwitchedAt: null,
    });

    const insight = getAccountInsight(account);

    expect(insight.syncLabel).toBe("刚刚 (实时)");
    expect(insight.hourlyQuota.available).toBe(false);
    expect(insight.weeklyQuota.available).toBe(false);
    expect(insight.hasRealRateLimits).toBe(false);
  });
});

describe("quota ranking", () => {
  it("recommends the best non-active account and returns the best overall account", () => {
    const active = createAccount({
      id: "active",
      isActive: true,
      rateLimits: {
        planType: "plus",
        primary: { usedPercent: 70 },
        secondary: { usedPercent: 30 },
      },
    });
    const candidate = createAccount({
      id: "candidate",
      displayName: "Backup",
      isActive: false,
      rateLimits: {
        planType: "plus",
        primary: { usedPercent: 15 },
        secondary: { usedPercent: 25 },
      },
    });
    const exhausted = createAccount({
      id: "exhausted",
      displayName: "Exhausted",
      rateLimits: {
        planType: "plus",
        primary: { usedPercent: 99 },
        secondary: { usedPercent: 99 },
      },
    });

    expect(getRecommendedAccountId([active, exhausted, candidate])).toBe("candidate");
    expect(getBestQuotaAccount([active, exhausted, candidate])?.id).toBe("candidate");
  });

  it("returns null when there is no usable quota data", () => {
    const account = createAccount({ rateLimits: null });
    expect(getRecommendedAccountId([account])).toBeNull();
    expect(getBestQuotaAccount([account])).toBeNull();
  });
});

describe("formatRelativeTime", () => {
  it("handles missing or invalid timestamps safely", () => {
    expect(formatRelativeTime(null)).toBe("暂无记录");
    expect(formatRelativeTime("invalid-date")).toBe("暂无记录");
  });
});
