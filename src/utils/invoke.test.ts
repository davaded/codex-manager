import { describe, expect, it } from "vitest";

import {
  buildMockPreheatedRateLimits,
  buildMockPreheatSkipMessage,
  buildMockPreheatSuccessMessage,
} from "./invoke";

describe("preheat mock messaging", () => {
  it("explains why an account is skipped", () => {
    const message = buildMockPreheatSkipMessage(
      {
        secondary: {
          usedPercent: 12,
          resetsAt: 10_000,
        },
      },
      6_400,
    );

    expect(message).toContain("已用 12%");
    expect(message).toContain("跳过预热");
  });

  it("treats fractional usage as an active weekly window", () => {
    const message = buildMockPreheatSkipMessage(
      {
        secondary: {
          usedPercent: 0.1,
          resetsAt: 10_000,
        },
      },
      6_400,
    );

    expect(message).toContain("已用 0.1%");
    expect(message).toContain("跳过预热");
  });

  it("explains when a lightweight request did not start the weekly timer", () => {
    const message = buildMockPreheatSuccessMessage(
      {
        secondary: {
          usedPercent: 0,
          resetsAt: 10_000,
        },
      },
      6_400,
    );

    expect(message).toContain("暂未开始计时");
  });

  it("explains when the weekly window payload is incomplete", () => {
    const message = buildMockPreheatSuccessMessage(
      {
        secondary: {
          usedPercent: 8,
        },
      },
      6_400,
    );

    expect(message).toContain("完整周限信息");
  });

  it("starts a fresh mock window without carrying expired usage", () => {
    const rateLimits = buildMockPreheatedRateLimits(
      {
        secondary: {
          usedPercent: 80,
          resetsAt: 1_000,
        },
      },
      6_400,
    );

    expect(rateLimits.secondary?.usedPercent).toBe(1);
    expect(rateLimits.secondary?.resetsAt).toBe(611_200);
  });
});
