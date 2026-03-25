import { describe, expect, it } from "vitest";
import {
  formatAuthIdentityLabel,
  hasAuthIdentity,
  matchesAccountIdentity,
  parseAuthIdentity,
} from "../src/utils/auth";
import type { Account } from "../src/types";

function toBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createJwt(payload: Record<string, unknown>): string {
  return `${toBase64Url({ alg: "none", typ: "JWT" })}.${toBase64Url(payload)}.signature`;
}

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "account-1",
    displayName: "Work",
    email: "dev@example.com",
    userId: "user-1",
    isActive: false,
    createdAt: "2026-03-01T00:00:00.000Z",
    lastSwitchedAt: null,
    sessionInfo: null,
    ...overrides,
  };
}

describe("parseAuthIdentity", () => {
  it("extracts account, email, user and plan information from JWT claims", () => {
    const accessToken = createJwt({
      chatgpt_account_id: "acc_123",
      email: "dev@example.com",
      user_id: "user-1",
      chatgpt_plan_type: "plus",
    });
    const idToken = createJwt({
      email: "fallback@example.com",
      sub: "sub-1",
    });

    const parsed = parseAuthIdentity(
      JSON.stringify({
        tokens: {
          access_token: accessToken,
          refresh_token: "refresh-123",
          id_token: idToken,
        },
      }),
    );

    expect(parsed.accountId).toBe("acc_123");
    expect(parsed.email).toBe("dev@example.com");
    expect(parsed.userId).toBe("user-1");
    expect(parsed.planType).toBe("plus");
    expect(parsed.refreshToken).toBe("refresh-123");
  });

  it("falls back to nested OpenAI auth/profile claims", () => {
    const accessToken = createJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acc_nested",
        chatgpt_user_id: "nested-user",
        chatgpt_plan_type: "team",
      },
      "https://api.openai.com/profile": {
        email: "nested@example.com",
      },
    });

    const parsed = parseAuthIdentity(
      JSON.stringify({
        tokens: {
          access_token: accessToken,
        },
      }),
    );

    expect(parsed.accountId).toBe("acc_nested");
    expect(parsed.userId).toBe("nested-user");
    expect(parsed.email).toBe("nested@example.com");
    expect(parsed.planType).toBe("team");
  });

  it("returns an empty identity for malformed auth payloads", () => {
    expect(parseAuthIdentity("not-json")).toEqual({
      accountId: null,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      email: null,
      userId: null,
      planType: null,
    });
  });
});

describe("identity helpers", () => {
  it("formats the best available identity label", () => {
    expect(
      formatAuthIdentityLabel({
        accountId: "acc_123",
        accessToken: null,
        refreshToken: null,
        idToken: null,
        email: "dev@example.com",
        userId: "user-1",
        planType: null,
      }),
    ).toBe("dev@example.com");

    expect(
      formatAuthIdentityLabel({
        accountId: "acc_123",
        accessToken: null,
        refreshToken: null,
        idToken: null,
        email: null,
        userId: "user-1",
        planType: null,
      }),
    ).toBe("user-1");
  });

  it("detects whether an identity is actually usable", () => {
    expect(
      hasAuthIdentity({
        accountId: null,
        accessToken: null,
        refreshToken: null,
        idToken: null,
        email: null,
        userId: null,
        planType: null,
      }),
    ).toBe(false);

    expect(
      hasAuthIdentity({
        accountId: "acc_123",
        accessToken: null,
        refreshToken: null,
        idToken: null,
        email: null,
        userId: null,
        planType: null,
      }),
    ).toBe(true);
  });

  it("matches accounts by normalized email or user id", () => {
    const account = createAccount();

    expect(
      matchesAccountIdentity(account, {
        accountId: null,
        accessToken: null,
        refreshToken: null,
        idToken: null,
        email: "DEV@example.com",
        userId: null,
        planType: null,
      }),
    ).toBe(true);

    expect(
      matchesAccountIdentity(account, {
        accountId: null,
        accessToken: null,
        refreshToken: null,
        idToken: null,
        email: null,
        userId: "USER-1",
        planType: null,
      }),
    ).toBe(true);
  });
});
