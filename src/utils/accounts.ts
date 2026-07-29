import { Account, PreheatAccountResult } from "../types";
import { api } from "./invoke";
import {
  ParsedAuthIdentity,
  findAccountForAuth,
  hasAuthIdentity,
  parseAuthIdentity,
} from "./auth";

export interface CurrentAuthState {
  activeAccountId: string | null;
  unmanagedIdentity: ParsedAuthIdentity | null;
  preserveStoredActive: boolean;
}

export function applyPreheatResult(
  account: Account,
  result: PreheatAccountResult,
): Account {
  const updatedAccount: Account = {
    ...account,
    lastPreheatAt: result.checkedAt,
    preheatStatus: result.outcome,
    preheatMessage: result.message,
  };

  if (result.rateLimitResult == null) {
    return updatedAccount;
  }

  const rateLimitResult = result.rateLimitResult;
  const isInvalid = rateLimitResult.accountStatus === "invalid";
  return {
    ...updatedAccount,
    rateLimits: isInvalid
      ? null
      : rateLimitResult.rateLimits ?? account.rateLimits ?? null,
    rateLimitsError: isInvalid
      ? rateLimitResult.accountStatusReason ?? "账号已失效或不可用"
      : null,
    accountStatus:
      rateLimitResult.accountStatus ??
      (rateLimitResult.rateLimits ? "available" : account.accountStatus ?? "unknown"),
    accountStatusReason: rateLimitResult.accountStatusReason ?? null,
  };
}

export async function resolveCurrentAuthState(accounts: Account[]): Promise<CurrentAuthState> {
  const storedActiveAccountId = accounts.find((account) => account.isActive)?.id ?? null;
  const currentAuth = await api.readAuthJson().catch(() => null);
  if (!currentAuth) {
    return {
      activeAccountId: storedActiveAccountId,
      unmanagedIdentity: null,
      preserveStoredActive: true,
    };
  }

  const matched = await findAccountForAuth(accounts, currentAuth);
  if (matched) {
    return {
      activeAccountId: matched.id,
      unmanagedIdentity: null,
      preserveStoredActive: false,
    };
  }

  const identity = parseAuthIdentity(currentAuth);
  return {
    activeAccountId: null,
    unmanagedIdentity: hasAuthIdentity(identity) ? identity : null,
    preserveStoredActive: false,
  };
}

export async function hydrateAccounts(accounts: Account[]): Promise<Account[]> {
  const currentAuthState = await resolveCurrentAuthState(accounts);
  const { activeAccountId, preserveStoredActive } = currentAuthState;
  const activeSessionInfo = activeAccountId
    ? await api.getCurrentSessionsInfo().catch(() => null)
    : null;

  return Promise.all(
    accounts.map(async (account) => {
      const rateLimitResult = await api
        .readAccountRateLimits(account.id)
        .then((result) => ({
          rateLimits: result.rateLimits ?? null,
          rateLimitsError:
            result.accountStatus === "invalid"
              ? result.accountStatusReason ?? "账号已失效或不可用"
              : null,
          accountStatus:
            result.accountStatus ?? (result.rateLimits ? "available" : "unknown"),
          accountStatusReason: result.accountStatusReason ?? null,
        }))
        .catch((error: unknown) => ({
          rateLimits: null,
          rateLimitsError: error instanceof Error ? error.message : String(error),
          accountStatus: "unknown" as const,
          accountStatusReason: null,
        }));
      const isActive = preserveStoredActive
        ? account.isActive
        : activeAccountId
          ? account.id === activeAccountId
          : false;

      if (isActive) {
        return {
          ...account,
          isActive,
          sessionInfo: activeSessionInfo ?? account.sessionInfo,
          rateLimits: rateLimitResult.rateLimits,
          rateLimitsError: rateLimitResult.rateLimitsError,
          accountStatus: rateLimitResult.accountStatus,
          accountStatusReason: rateLimitResult.accountStatusReason,
        };
      }

      return {
        ...account,
        isActive,
        sessionInfo: account.sessionInfo,
        rateLimits: rateLimitResult.rateLimits,
        rateLimitsError: rateLimitResult.rateLimitsError,
        accountStatus: rateLimitResult.accountStatus,
        accountStatusReason: rateLimitResult.accountStatusReason,
      };
    }),
  );
}
