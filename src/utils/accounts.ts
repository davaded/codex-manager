import { Account } from "../types";
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

interface HydrateAccountsOptions {
  refreshAllRateLimits?: boolean;
  refreshRateLimitAccountIds?: ReadonlySet<string>;
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

export async function hydrateAccounts(
  accounts: Account[],
  options: HydrateAccountsOptions = {},
): Promise<Account[]> {
  const currentAuthState = await resolveCurrentAuthState(accounts);
  const { activeAccountId, preserveStoredActive } = currentAuthState;
  const activeSessionInfo = activeAccountId
    ? await api.getCurrentSessionsInfo().catch(() => null)
    : null;

  return Promise.all(
    accounts.map(async (account) => {
      const isActive = preserveStoredActive
        ? account.isActive
        : activeAccountId
          ? account.id === activeAccountId
          : false;
      const shouldRefreshRateLimits =
        options.refreshAllRateLimits === true ||
        isActive ||
        options.refreshRateLimitAccountIds?.has(account.id) === true;
      const rateLimitResult = shouldRefreshRateLimits
        ? await api
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
            }))
        : {
            rateLimits: account.rateLimits ?? null,
            rateLimitsError: account.rateLimitsError ?? null,
            accountStatus: account.accountStatus ?? (account.rateLimits ? "available" : "unknown"),
            accountStatusReason: account.accountStatusReason ?? null,
          };

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
