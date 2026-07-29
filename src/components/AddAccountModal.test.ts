import { describe, expect, it } from "vitest";

import {
  isOauthAttemptActive,
  isOauthCancelledError,
  type OAuthAttempt,
} from "./AddAccountModal";

describe("OAuth cancellation classification", () => {
  it("recognizes the current and legacy cancellation contracts", () => {
    expect(isOauthCancelledError("[oauth:cancelled] OAuth flow cancelled by user")).toBe(true);
    expect(isOauthCancelledError("OAuth flow cancelled by user")).toBe(true);
  });

  it("does not swallow recoverable OAuth errors that mention cancellation", () => {
    expect(
      isOauthCancelledError(
        "[oauth:flow_active] 已有一个授权流程正在进行，请先完成或取消当前授权。",
      ),
    ).toBe(false);
    expect(
      isOauthCancelledError(
        "[oauth:browser_auth_error] 如果你刚刚取消了登录或拒绝了授权，请重新开始。",
      ),
    ).toBe(false);
  });
});

describe("OAuth attempt lifecycle", () => {
  it("continues only while the exact attempt owns the mounted flow", () => {
    const attempt: OAuthAttempt = { id: 1, cancelled: false };

    expect(isOauthAttemptActive(attempt, attempt, true)).toBe(true);
    expect(isOauthAttemptActive({ id: 1, cancelled: false }, attempt, true)).toBe(false);
    expect(isOauthAttemptActive(attempt, attempt, false)).toBe(false);
  });

  it("stops every later async stage once the attempt is cancelled", () => {
    const attempt: OAuthAttempt = { id: 1, cancelled: false };
    attempt.cancelled = true;

    expect(isOauthAttemptActive(attempt, attempt, true)).toBe(false);
  });

  it("stops stale results after ownership moves to another attempt", () => {
    const staleAttempt: OAuthAttempt = { id: 1, cancelled: false };
    const activeAttempt: OAuthAttempt = { id: 2, cancelled: false };

    expect(isOauthAttemptActive(activeAttempt, staleAttempt, true)).toBe(false);
  });
});
