import { Account } from "../types";
import { api } from "./invoke";
import { findAccountForAuth } from "./auth";

async function resolveActiveAccountId(accounts: Account[]): Promise<string | null> {
  const currentAuth = await api.readAuthJson().catch(() => null);
  if (!currentAuth) {
    return accounts.find((account) => account.isActive)?.id ?? null;
  }
  const matched = await findAccountForAuth(accounts, currentAuth);
  return matched?.id ?? null;
}

export async function hydrateAccounts(accounts: Account[]): Promise<Account[]> {
  const activeAccountId = await resolveActiveAccountId(accounts);
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
      const isActive = activeAccountId ? account.id === activeAccountId : account.isActive;

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
