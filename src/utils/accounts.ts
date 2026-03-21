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
        .then((rateLimits) => ({
          rateLimits,
          rateLimitsError: null,
        }))
        .catch((error: unknown) => ({
          rateLimits: null,
          rateLimitsError: error instanceof Error ? error.message : String(error),
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
        };
      }

      return {
        ...account,
        isActive,
        sessionInfo: account.sessionInfo,
        rateLimits: rateLimitResult.rateLimits,
        rateLimitsError: rateLimitResult.rateLimitsError,
      };
    }),
  );
}
