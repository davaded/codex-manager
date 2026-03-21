import { Account } from "../types";
import { api } from "./invoke";

export interface ParsedAuthIdentity {
  accountId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  email: string | null;
  userId: string | null;
  planType: string | null;
}

export function hasAuthIdentity(identity: ParsedAuthIdentity): boolean {
  return Boolean(identity.email || identity.userId || identity.accountId);
}

export function formatAuthIdentityLabel(identity: ParsedAuthIdentity | null): string | null {
  if (!identity) {
    return null;
  }

  return identity.email ?? identity.userId ?? identity.accountId ?? null;
}

function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractAccountId(payload: Record<string, unknown> | null): string | null {
  if (!payload) {
    return null;
  }

  const direct = payload.chatgpt_account_id;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  const nested = payload["https://api.openai.com/auth"];
  if (nested && typeof nested === "object" && "chatgpt_account_id" in nested) {
    const value = (nested as Record<string, unknown>).chatgpt_account_id;
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function extractEmail(payload: Record<string, unknown> | null): string | null {
  if (!payload) {
    return null;
  }

  const direct = payload.email;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  const profile = payload["https://api.openai.com/profile"];
  if (profile && typeof profile === "object" && "email" in profile) {
    const value = (profile as Record<string, unknown>).email;
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function extractUserId(payload: Record<string, unknown> | null): string | null {
  if (!payload) {
    return null;
  }

  const direct = payload.user_id;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  const nested = payload["https://api.openai.com/auth"];
  if (nested && typeof nested === "object") {
    const authClaims = nested as Record<string, unknown>;
    const chatgptUserId = authClaims.chatgpt_user_id;
    if (typeof chatgptUserId === "string" && chatgptUserId.trim()) {
      return chatgptUserId;
    }
    const userId = authClaims.user_id;
    if (typeof userId === "string" && userId.trim()) {
      return userId;
    }
  }

  const sub = payload.sub;
  if (typeof sub === "string" && sub.trim()) {
    return sub;
  }

  return null;
}

function extractPlanType(payload: Record<string, unknown> | null): string | null {
  if (!payload) {
    return null;
  }

  const direct = payload.chatgpt_plan_type;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  const nested = payload["https://api.openai.com/auth"];
  if (nested && typeof nested === "object" && "chatgpt_plan_type" in nested) {
    const value = (nested as Record<string, unknown>).chatgpt_plan_type;
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

export function parseAuthIdentity(content: string): ParsedAuthIdentity {
  try {
    const parsed = JSON.parse(content) as {
      tokens?: {
        account_id?: string | null;
        access_token?: string | null;
        refresh_token?: string | null;
        id_token?: string | null;
      };
    };

    const accessToken = parsed.tokens?.access_token ?? null;
    const idToken = parsed.tokens?.id_token ?? null;
    const accessPayload = decodeJwtPayload(accessToken);
    const idPayload = decodeJwtPayload(idToken);

    return {
      accountId:
        parsed.tokens?.account_id ??
        extractAccountId(accessPayload) ??
        extractAccountId(idPayload),
      accessToken,
      refreshToken: parsed.tokens?.refresh_token ?? null,
      idToken,
      email: extractEmail(accessPayload) ?? extractEmail(idPayload),
      userId: extractUserId(accessPayload) ?? extractUserId(idPayload),
      planType: extractPlanType(accessPayload) ?? extractPlanType(idPayload),
    };
  } catch {
    return {
      accountId: null,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      email: null,
      userId: null,
      planType: null,
    };
  }
}

export function matchesAccountIdentity(account: Account, identity: ParsedAuthIdentity): boolean {
  if (
    identity.accountId &&
    account.accountId?.trim().toLowerCase() === identity.accountId.trim().toLowerCase()
  ) {
    return true;
  }

  if (identity.email && account.email?.trim().toLowerCase() === identity.email.trim().toLowerCase()) {
    return true;
  }

  if (identity.userId && account.userId?.trim().toLowerCase() === identity.userId.trim().toLowerCase()) {
    return true;
  }

  return false;
}

export async function findAccountForAuth(
  accounts: Account[],
  currentAuth: string,
): Promise<Account | null> {
  const identity = parseAuthIdentity(currentAuth);
  const fallbackMatches: Account[] = [];
  for (const account of accounts) {
    if (matchesAccountIdentity(account, identity)) {
      fallbackMatches.push(account);
    }

    const savedAuth = await api.readAccountCredentials(account.id).catch(() => null);
    if (!savedAuth) {
      continue;
    }

    const savedIdentity = parseAuthIdentity(savedAuth);
    if (identity.accountId && savedIdentity.accountId && identity.accountId === savedIdentity.accountId) {
      return account;
    }
    if (
      identity.refreshToken &&
      savedIdentity.refreshToken &&
      identity.refreshToken === savedIdentity.refreshToken
    ) {
      return account;
    }
    if (
      identity.accessToken &&
      savedIdentity.accessToken &&
      identity.accessToken === savedIdentity.accessToken
    ) {
      return account;
    }
    if (identity.idToken && savedIdentity.idToken && identity.idToken === savedIdentity.idToken) {
      return account;
    }
    if (currentAuth.trim() === savedAuth.trim()) {
      return account;
    }
  }

  return fallbackMatches[0] ?? null;
}
