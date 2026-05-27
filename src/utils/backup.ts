import { Account, AppSettings, BackupBundle, BackupBundleAccount } from "../types";
import { api } from "./invoke";
import { hydrateAccounts } from "./accounts";
import { matchesAccountIdentity, parseAuthIdentity } from "./auth";

interface NormalizedBackupImport {
  accounts: Account[];
  settings: AppSettings;
}

function assertBackupBundle(value: unknown): asserts value is BackupBundle {
  if (!value || typeof value !== "object") {
    throw new Error("备份文件格式无效");
  }

  const bundle = value as Partial<BackupBundle>;
  if (!Array.isArray(bundle.accounts)) {
    throw new Error("备份文件缺少账户列表");
  }
  if (!bundle.settings || typeof bundle.settings !== "object") {
    throw new Error("备份文件缺少设置数据");
  }
}

function normalizeBackupSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    autoRefreshInterval:
      typeof settings.autoRefreshInterval === "number"
        ? settings.autoRefreshInterval
        : 0,
    autoRestartCodexAfterSwitch:
      typeof settings.autoRestartCodexAfterSwitch === "boolean"
        ? settings.autoRestartCodexAfterSwitch
        : true,
    autoRestartVscodeAfterSwitch:
      typeof settings.autoRestartVscodeAfterSwitch === "boolean"
        ? settings.autoRestartVscodeAfterSwitch
        : false,
    theme:
      settings.theme === "light" ||
      settings.theme === "dark" ||
      settings.theme === "system"
        ? settings.theme
        : "system",
    proxyUrl: typeof settings.proxyUrl === "string" ? settings.proxyUrl : "",
  };
}

function normalizeBackupImport(parsed: BackupBundle): NormalizedBackupImport {
  const accounts = parsed.accounts
    .map((entry) => entry.account)
    .filter((account): account is Account => Boolean(account?.id && account.displayName));

  if (accounts.length !== parsed.accounts.length) {
    throw new Error("备份文件包含无效账户条目");
  }

  const uniqueIds = new Set(accounts.map((account) => account.id));
  if (uniqueIds.size !== accounts.length) {
    throw new Error("备份文件包含重复账户 ID");
  }

  return {
    accounts,
    settings: normalizeBackupSettings(parsed.settings),
  };
}

function isPresentCredential(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function matchesCurrentAuth(account: Account, authJson: string): boolean {
  const identity = parseAuthIdentity(authJson);
  const accountUserId = account.userId?.trim().toLowerCase() ?? null;
  const identityAccountId = identity.accountId?.trim().toLowerCase() ?? null;

  return (
    matchesAccountIdentity(account, identity) ||
    Boolean(accountUserId && identityAccountId && accountUserId === identityAccountId)
  );
}

function resolveBackupCredentials(
  account: Account,
  credentials: string | null | undefined,
  currentAuthJson: string | null | undefined,
): string | null {
  if (isPresentCredential(credentials)) {
    return credentials;
  }

  if (
    account.isActive &&
    isPresentCredential(currentAuthJson) &&
    matchesCurrentAuth(account, currentAuthJson)
  ) {
    return currentAuthJson;
  }

  return null;
}

function formatAccountList(accounts: Account[]): string {
  return accounts.map((account) => account.displayName || account.id).join("、");
}

export function collectBackupCredentialsForImport(parsed: BackupBundle): Map<string, string> {
  const credentialsByAccountId = new Map<string, string>();
  const missingAccounts: Account[] = [];

  for (const entry of parsed.accounts) {
    const account = entry.account;
    const resolved = resolveBackupCredentials(
      account,
      entry.credentials,
      parsed.currentAuthJson,
    );

    if (!resolved) {
      missingAccounts.push(account);
      continue;
    }

    credentialsByAccountId.set(account.id, resolved);
  }

  if (missingAccounts.length > 0) {
    throw new Error(
      `备份缺少账号凭据：${formatAccountList(missingAccounts)}。请在源电脑重新导出完整备份。`,
    );
  }

  return credentialsByAccountId;
}

function downloadJson(content: string, fileName: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportBackupBundle(
  accounts: Account[],
  settings: AppSettings,
): Promise<void> {
  const currentAuthJson = await api.readAuthJson().catch(() => null);
  const exportedAccounts: BackupBundleAccount[] = await Promise.all(
    accounts.map(async (account) => ({
      account,
      credentials: resolveBackupCredentials(
        account,
        await api.readAccountCredentials(account.id).catch(() => null),
        currentAuthJson,
      ),
    })),
  );
  const missingAccounts = exportedAccounts
    .filter((entry) => !entry.credentials)
    .map((entry) => entry.account);

  if (missingAccounts.length > 0) {
    throw new Error(
      `无法导出完整备份，缺少账号凭据：${formatAccountList(missingAccounts)}。请先重新导入这些账号的当前授权。`,
    );
  }

  const bundle: BackupBundle = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    settings,
    currentAuthJson,
    accounts: exportedAccounts,
  };

  downloadJson(
    JSON.stringify(bundle, null, 2),
    `codex-manager-backup-${new Date().toISOString().slice(0, 10)}.json`,
  );
}

export async function importBackupBundle(
  file: File,
  existingAccounts: Account[],
): Promise<{ accounts: Account[]; settings: AppSettings }> {
  const content = await file.text();
  const parsed = JSON.parse(content) as BackupBundle;
  assertBackupBundle(parsed);
  const normalized = normalizeBackupImport(parsed);
  const nextAccounts = normalized.accounts;
  const removedAccounts = existingAccounts.filter(
    (account) => !nextAccounts.some((item) => item.id === account.id),
  );
  const previousCredentials = new Map<string, string | null>();
  const credentialsByAccountId = collectBackupCredentialsForImport(parsed);
  const accountIdsToWrite = new Set(credentialsByAccountId.keys());
  const shouldReplaceCurrentAuth =
    Boolean(parsed.currentAuthJson) && nextAccounts.some((account) => account.isActive);
  const previousAuthJson = shouldReplaceCurrentAuth
    ? await api.readAuthJson().catch(() => null)
    : null;
  let accountsSaved = false;

  try {
    for (const accountId of accountIdsToWrite) {
      const existingCredentials = await api.readAccountCredentials(accountId).catch(() => null);
      previousCredentials.set(accountId, existingCredentials);
    }

    for (const [accountId, credentials] of credentialsByAccountId) {
      await api.saveAccountCredentials(accountId, credentials);
    }

    if (shouldReplaceCurrentAuth) {
      await api.writeAuthJson(parsed.currentAuthJson as string);
    }

    const hydratedAccounts = await hydrateAccounts(nextAccounts);
    await api.saveAccounts({ version: "1.0", accounts: hydratedAccounts });
    accountsSaved = true;

    for (const account of removedAccounts) {
      await api.deleteAccountCredentials(account.id).catch(() => undefined);
      await api.deleteAccountSessions(account.id).catch(() => undefined);
    }

    return {
      accounts: hydratedAccounts,
      settings: normalized.settings,
    };
  } catch (error) {
    if (!accountsSaved) {
      for (const accountId of accountIdsToWrite) {
        const previous = previousCredentials.get(accountId) ?? null;
        if (previous === null) {
          await api.deleteAccountCredentials(accountId).catch(() => undefined);
        } else {
          await api.saveAccountCredentials(accountId, previous).catch(() => undefined);
        }
      }

      if (shouldReplaceCurrentAuth) {
        if (previousAuthJson === null) {
          // If no prior live auth was available, leave the current file untouched on rollback.
        } else {
          await api.writeAuthJson(previousAuthJson).catch(() => undefined);
        }
      }
    }

    throw error;
  }
}
