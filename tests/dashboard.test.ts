import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  getAccountInsight,
  getBestQuotaAccount,
  getHourlyUsageEfficiency,
  getRecommendedAccountId,
  getSmartSwitchDecision,
  getSmartSwitchAccount,
  shouldSmartSwitchAccount,
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
      lastSessionObservedAt: "2026-03-11T10:00:00Z",
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
        primary: {
          remainingPercent: 92,
          resetsAt: Date.UTC(2026, 4, 9, 18, 43) / 1000,
        },
        secondary: {
          remainingPercent: 44,
          resetsAt: Date.UTC(2026, 4, 15, 16, 30) / 1000,
        },
      },
    });

    const insight = getAccountInsight(account);

    expect(insight.roleLabel).toBe("Pro");
    expect(insight.hourlyQuota.valueLabel).toBe("92% · 02:43");
    expect(insight.hourlyQuota.detail).toBe("重置时间 2026-05-10 02:43");
    expect(insight.hourlyQuota.tone).toBe("healthy");
    expect(insight.weeklyQuota.valueLabel).toBe("44% · 5月16日 00:30");
    expect(insight.weeklyQuota.detail).toBe("重置时间 2026-05-16 00:30");
    expect(insight.weeklyQuota.tone).toBe("warning");
    expect(insight.syncLabel).toBe("2026-03-11 18:00");
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
  it("returns the best overall account without recommending a switch while active quota is healthy", () => {
    const active = createAccount({
      id: "active",
      isActive: true,
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 70 },
        secondary: { remainingPercent: 30 },
      },
    });
    const candidate = createAccount({
      id: "candidate",
      displayName: "Backup",
      isActive: false,
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 15 },
        secondary: { remainingPercent: 25 },
      },
    });
    const exhausted = createAccount({
      id: "exhausted",
      displayName: "Exhausted",
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 99 },
        secondary: { remainingPercent: 99 },
      },
    });

    expect(getRecommendedAccountId([active, exhausted, candidate])).toBeNull();
    expect(getSmartSwitchAccount([active, exhausted, candidate])).toBeNull();
    expect(getBestQuotaAccount([active, exhausted, candidate])?.id).toBe("exhausted");
  });

  it("returns a hold decision while active quota is healthy", () => {
    const active = createAccount({
      id: "active",
      isActive: true,
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 5 },
        secondary: { remainingPercent: 2 },
      },
    });
    const candidate = createAccount({
      id: "candidate",
      displayName: "Backup",
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 80 },
        secondary: { remainingPercent: 80 },
      },
    });

    expect(getSmartSwitchDecision([active, candidate])).toEqual({
      status: "hold",
      activeAccount: active,
    });
  });

  it("recommends a switch when active 5h quota is below 5%", () => {
    const active = createAccount({
      id: "active",
      isActive: true,
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 4 },
        secondary: { remainingPercent: 80 },
      },
    });
    const candidate = createAccount({
      id: "candidate",
      displayName: "Backup",
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 40 },
        secondary: { remainingPercent: 20 },
      },
    });

    expect(shouldSmartSwitchAccount(active)).toBe(true);
    expect(getRecommendedAccountId([active, candidate])).toBe("candidate");
    expect(getSmartSwitchAccount([active, candidate])?.id).toBe("candidate");
  });

  it("recommends a switch when active weekly quota is below 2%", () => {
    const active = createAccount({
      id: "active",
      isActive: true,
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 50 },
        secondary: { remainingPercent: 1 },
      },
    });
    const candidate = createAccount({
      id: "candidate",
      displayName: "Backup",
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 30 },
        secondary: { remainingPercent: 10 },
      },
    });

    expect(shouldSmartSwitchAccount(active)).toBe(true);
    expect(getRecommendedAccountId([active, candidate])).toBe("candidate");
  });

  it("does not switch at the exact smart switch thresholds", () => {
    const active = createAccount({
      id: "active",
      isActive: true,
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 5 },
        secondary: { remainingPercent: 2 },
      },
    });
    const candidate = createAccount({
      id: "candidate",
      displayName: "Backup",
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 80 },
        secondary: { remainingPercent: 80 },
      },
    });

    expect(shouldSmartSwitchAccount(active)).toBe(false);
    expect(getRecommendedAccountId([active, candidate])).toBeNull();
  });

  it("can recommend another account even when it is below a smart switch threshold", () => {
    const active = createAccount({
      id: "active",
      isActive: true,
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 4 },
        secondary: { remainingPercent: 80 },
      },
    });
    const depletedCandidate = createAccount({
      id: "depleted",
      displayName: "Depleted",
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 80 },
        secondary: { remainingPercent: 1 },
      },
    });

    expect(getRecommendedAccountId([active, depletedCandidate])).toBe("depleted");
    expect(getSmartSwitchAccount([active, depletedCandidate])?.id).toBe("depleted");
  });

  it("does not recommend an account with depleted weekly quota", () => {
    const active = createAccount({
      id: "active",
      isActive: true,
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 4 },
        secondary: { remainingPercent: 80 },
      },
    });
    const weeklyDepletedCandidate = createAccount({
      id: "weekly-depleted",
      displayName: "Weekly Depleted",
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 80 },
        secondary: { remainingPercent: 0 },
      },
    });

    expect(getRecommendedAccountId([active, weeklyDepletedCandidate])).toBeNull();
    expect(getSmartSwitchAccount([active, weeklyDepletedCandidate])).toBeNull();
    expect(getBestQuotaAccount([active, weeklyDepletedCandidate])?.id).toBe("active");
  });

  it("returns null when there is no usable quota data", () => {
    const account = createAccount({ rateLimits: null });
    expect(getRecommendedAccountId([account])).toBeNull();
    expect(getBestQuotaAccount([account])).toBeNull();
  });

  it("returns no target when active quota is low and no standby account has quota data", () => {
    const account = createAccount({
      id: "active",
      isActive: true,
      rateLimits: {
        planType: "plus",
        primary: { remainingPercent: 4 },
      },
    });

    expect(getSmartSwitchDecision([account])).toEqual({
      status: "no_target",
      activeAccount: account,
    });
  });
});

describe("getHourlyUsageEfficiency", () => {
  it("calculates balanced usage when consumption roughly matches elapsed time", () => {
    const now = new Date("2026-03-11T10:00:00Z").getTime();
    const account = createAccount({
      rateLimits: {
        planType: "plus",
        primary: {
          remainingPercent: 52,
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
          remainingPercent: 80,
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
          primary: { remainingPercent: 80 },
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
