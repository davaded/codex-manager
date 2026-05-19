import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../src/types";

const apiMock = vi.hoisted(() => ({
  readAuthJson: vi.fn(),
  readAccountCredentials: vi.fn(),
  getCurrentSessionsInfo: vi.fn(),
  readAccountRateLimits: vi.fn(),
}));

vi.mock("../src/utils/invoke", () => ({
  api: apiMock,
}));

import { hydrateAccounts } from "../src/utils/accounts";

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "account-1",
    displayName: "Account",
    email: "account@example.com",
    userId: "user-1",
    isActive: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    lastSwitchedAt: null,
    sessionInfo: null,
    rateLimits: null,
    rateLimitsError: null,
    accountStatus: "unknown",
    accountStatusReason: null,
    ...overrides,
  };
}

describe("hydrateAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.readAuthJson.mockResolvedValue(null);
    apiMock.readAccountCredentials.mockResolvedValue(null);
    apiMock.getCurrentSessionsInfo.mockResolvedValue(null);
    apiMock.readAccountRateLimits.mockResolvedValue({
      rateLimits: {
        limitId: "codex",
        planType: "team",
        primary: { remainingPercent: 99, windowDurationMins: 300, resetsAt: 1_800 },
        secondary: { remainingPercent: 41, windowDurationMins: 10_080, resetsAt: 604_800 },
      },
      accountStatus: "available",
      accountStatusReason: null,
    });
  });

  it("refreshes official quota only for the active account", async () => {
    const active = createAccount({ id: "active", isActive: true });
    const standby = createAccount({
      id: "standby",
      email: "standby@example.com",
      rateLimits: {
        limitId: "codex",
        planType: "team",
        primary: { remainingPercent: 23, windowDurationMins: 300, resetsAt: 900 },
        secondary: { remainingPercent: 65, windowDurationMins: 10_080, resetsAt: 500_000 },
      },
      accountStatus: "available",
    });

    const hydrated = await hydrateAccounts([active, standby]);

    expect(apiMock.readAccountRateLimits).toHaveBeenCalledTimes(1);
    expect(apiMock.readAccountRateLimits).toHaveBeenCalledWith("active");
    expect(hydrated.find((account) => account.id === "active")?.rateLimits?.primary?.remainingPercent).toBe(99);
    expect(hydrated.find((account) => account.id === "standby")?.rateLimits?.primary?.remainingPercent).toBe(23);
  });

  it("keeps standby quota unchanged during default hydration", async () => {
    const standby = createAccount({
      id: "standby",
      email: "standby@example.com",
      rateLimits: {
        limitId: "codex",
        planType: "team",
        primary: { remainingPercent: 23, windowDurationMins: 300, resetsAt: 900 },
        secondary: { remainingPercent: 65, windowDurationMins: 10_080, resetsAt: 500_000 },
      },
      accountStatus: "available",
    });

    const [hydrated] = await hydrateAccounts([standby]);

    expect(apiMock.readAccountRateLimits).not.toHaveBeenCalled();
    expect(hydrated.rateLimits?.primary?.remainingPercent).toBe(23);
    expect(hydrated.rateLimits?.secondary?.remainingPercent).toBe(65);
  });

  it("refreshes quota for every account when requested", async () => {
    const active = createAccount({ id: "active", isActive: true });
    const standby = createAccount({
      id: "standby",
      email: "standby@example.com",
      rateLimits: {
        limitId: "codex",
        planType: "team",
        primary: { remainingPercent: 23, windowDurationMins: 300, resetsAt: 900 },
        secondary: { remainingPercent: 65, windowDurationMins: 10_080, resetsAt: 500_000 },
      },
      accountStatus: "available",
    });

    const hydrated = await hydrateAccounts([active, standby], { refreshAllRateLimits: true });

    expect(apiMock.readAccountRateLimits).toHaveBeenCalledTimes(2);
    expect(apiMock.readAccountRateLimits).toHaveBeenCalledWith("active");
    expect(apiMock.readAccountRateLimits).toHaveBeenCalledWith("standby");
    expect(hydrated.find((account) => account.id === "active")?.rateLimits?.primary?.remainingPercent).toBe(99);
    expect(hydrated.find((account) => account.id === "standby")?.rateLimits?.primary?.remainingPercent).toBe(99);
    expect(hydrated.find((account) => account.id === "standby")?.rateLimits?.secondary?.remainingPercent).toBe(41);
  });

  it("refreshes quota for a selected standby account", async () => {
    const standby = createAccount({
      id: "standby",
      email: "standby@example.com",
      rateLimits: null,
      accountStatus: "unknown",
    });

    const [hydrated] = await hydrateAccounts([standby], {
      refreshRateLimitAccountIds: new Set(["standby"]),
    });

    expect(apiMock.readAccountRateLimits).toHaveBeenCalledTimes(1);
    expect(apiMock.readAccountRateLimits).toHaveBeenCalledWith("standby");
    expect(hydrated.rateLimits?.primary?.remainingPercent).toBe(99);
    expect(hydrated.rateLimits?.secondary?.remainingPercent).toBe(41);
  });
});
