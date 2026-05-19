import { describe, expect, it } from "vitest";
import {
  buildQuotaCompassSummary,
  formatCompactTokenNumber,
  getDailyTokenTotal,
} from "../src/utils/quotaCompass";

describe("quota compass", () => {
  it("uses explicit token totals before component totals", () => {
    expect(
      getDailyTokenTotal({
        textTotalTokens: 1_200_000,
        cachedTextInputTokens: 100,
        uncachedTextInputTokens: 100,
        textOutputTokens: 100,
      }),
    ).toBe(1_200_000);
  });

  it("splits current cycle and history while projecting total credits", () => {
    const summary = buildQuotaCompassSummary(
      [
        { date: "2026-03-08", totals: { credits: 1, turns: 2, textTotalTokens: 1_000 } },
        {
          date: "2026-03-11",
          totals: {
            credits: 2,
            turns: 3,
            cachedTextInputTokens: 100,
            uncachedTextInputTokens: 200,
            textOutputTokens: 300,
          },
        },
        { date: "2026-03-12", totals: { credits: 3, turns: 4, textTotalTokens: 2_000 } },
      ],
      "2026-03-10",
      { remainingPercent: 75 },
    );

    expect(summary.historyStats.credits).toBe(1);
    expect(summary.currentStats.credits).toBe(5);
    expect(summary.currentStats.turns).toBe(7);
    expect(summary.currentStats.tokens).toBe(2_600);
    expect(summary.usedPercent).toBe(25);
    expect(summary.estimatedTotalCredits).toBe(20);
    expect(summary.estimatedTotalUsd).toBe(0.8);
  });

  it("estimates credits from model token usage when official credits are zero", () => {
    const summary = buildQuotaCompassSummary(
      [
        {
          date: "2026-03-12",
          totals: {
            credits: 0,
            turns: 4,
            cachedTextInputTokens: 1_000_000,
            uncachedTextInputTokens: 1_000_000,
            textOutputTokens: 100_000,
          },
          models: [
            {
              model: "gpt-5.5",
              credits: 0,
              cachedTextInputTokens: 1_000_000,
              uncachedTextInputTokens: 1_000_000,
              textOutputTokens: 100_000,
              textTotalTokens: 2_100_000,
            },
          ],
        },
      ],
      "2026-03-10",
      { remainingPercent: 75 },
    );

    expect(summary.currentStats.usd).toBeCloseTo(8.5, 6);
    expect(summary.currentStats.credits).toBeCloseTo(212.5, 6);
    expect(summary.estimatedTotalUsd).toBeCloseTo(34, 6);
    expect(summary.estimatedTotalCredits).toBeCloseTo(850, 6);
  });

  it("formats token numbers with K and M units", () => {
    expect(formatCompactTokenNumber(980)).toBe("980");
    expect(formatCompactTokenNumber(12_340)).toBe("12.34K");
    expect(formatCompactTokenNumber(1_234_000)).toBe("1.23M");
  });
});
