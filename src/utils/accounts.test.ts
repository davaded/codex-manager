import { describe, expect, it } from "vitest";

import type { Account, PreheatAccountResult } from "../types";
import { applyPreheatResult } from "./accounts";

const account: Account = {
  id: "account-1",
  displayName: "Account",
  email: "account@example.com",
  userId: "user-1",
  isActive: false,
  createdAt: "2026-07-28T00:00:00.000Z",
  lastSwitchedAt: null,
  sessionInfo: null,
  accountStatus: "available",
  rateLimits: {
    planType: "plus",
    secondary: { usedPercent: 20, resetsAt: 2_000 },
  },
};

function result(overrides: Partial<PreheatAccountResult>): PreheatAccountResult {
  return {
    accountId: account.id,
    outcome: "error",
    message: "预热失败",
    checkedAt: "2026-07-28T01:00:00.000Z",
    ...overrides,
  };
}

describe("applyPreheatResult", () => {
  it("preserves the last quota when no readback result is available", () => {
    const next = applyPreheatResult(account, result({ rateLimitResult: null }));

    expect(next.rateLimits).toEqual(account.rateLimits);
    expect(next.accountStatus).toBe("available");
    expect(next.preheatStatus).toBe("error");
  });

  it("clears stale quota when the backend explicitly marks the account invalid", () => {
    const next = applyPreheatResult(
      account,
      result({
        rateLimitResult: {
          rateLimits: null,
          accountStatus: "invalid",
          accountStatusReason: "登录已过期",
        },
      }),
    );

    expect(next.rateLimits).toBeNull();
    expect(next.rateLimitsError).toBe("登录已过期");
    expect(next.accountStatus).toBe("invalid");
  });
});
