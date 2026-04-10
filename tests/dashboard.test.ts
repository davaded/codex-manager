import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  getAccountInsight,
  getBestQuotaAccount,
  getHourlyUsageEfficiency,
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
    expect(insight.hourlyQuota.valueLabel).toBe("8% 剩余");
    expect(insight.hourlyQuota.centerLabel).toBe("剩余");
    expect(insight.hourlyQuota.detail).toContain("已用 92%");
    expect(insight.hourlyQuota.tone).toBe("critical");
    expect(insight.weeklyQuota.valueLabel).toBe("56% 剩余");
    expect(insight.weeklyQuota.centerLabel).toBe("剩余");
    expect(insight.weeklyQuota.detail).toContain("已用 44%");
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
  it("recommends the best overall account even when it is already active", () => {
    const active = createAccount({
      id: "active",
      isActive: true,
      rateLimits: {
        planType: "plus",
        primary: { usedPercent: 15 },
        secondary: { usedPercent: 20 },
      },
    });
    const candidate = createAccount({
      id: "candidate",
      displayName: "Backup",
      isActive: false,
      rateLimits: {
        planType: "plus",
        primary: { usedPercent: 40 },
        secondary: { usedPercent: 35 },
      },
    });

    expect(getRecommendedAccountId([active, candidate])).toBe("active");
    expect(getBestQuotaAccount([active, candidate])?.id).toBe("active");
  });

  it("recommends a standby account when it is better than the current one", () => {
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

describe("getHourlyUsageEfficiency", () => {
  it("calculates balanced usage when consumption roughly matches elapsed time", () => {
    const now = new Date("2026-03-11T10:00:00Z").getTime();
    const account = createAccount({
      rateLimits: {
        planType: "plus",
        primary: {
          usedPercent: 48,
          resetsAt: Math.floor(new Date("2026-03-11T12:30:00Z").getTime() / 1000),
          windowDurationMins: 300,
        },
      },
    });

    const efficiency = getHourlyUsageEfficiency(account, now);

    expect(efficiency.status).toBe("balanced");
    expect(efficiency.score).toBeGreaterThan(90);
    expect(efficiency.score).toBeLessThan(110);
  });

  it("marks low-efficiency windows as underused", () => {
    const now = new Date("2026-03-11T10:00:00Z").getTime();
    const account = createAccount({
      rateLimits: {
        planType: "plus",
        primary: {
          usedPercent: 20,
          resetsAt: Math.floor(new Date("2026-03-11T11:00:00Z").getTime() / 1000),
          windowDurationMins: 300,
        },
      },
    });

    const efficiency = getHourlyUsageEfficiency(account, now);

    expect(efficiency.status).toBe("underused");
    expect(efficiency.score).toBeLessThan(70);
  });

  it("returns unavailable when required window fields are missing", () => {
    const efficiency = getHourlyUsageEfficiency(
      createAccount({
        rateLimits: {
          planType: "plus",
          primary: { usedPercent: 20 },
        },
      }),
    );

    expect(efficiency.status).toBe("unavailable");
    expect(efficiency.score).toBeNull();
  });
});

describe("formatRelativeTime", () => {
  it("handles missing or invalid timestamps safely", () => {
    expect(formatRelativeTime(null)).toBe("暂无记录");
    expect(formatRelativeTime("invalid-date")).toBe("暂无记录");
  });
});
