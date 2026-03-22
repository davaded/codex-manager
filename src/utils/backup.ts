import { Account, AppSettings, BackupBundle, BackupBundleAccount } from "../types";
import { api } from "./invoke";
import { hydrateAccounts } from "./accounts";

async function sequence<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (const item of items) {
    await fn(item);
  }
}

type RestoreOperation = {
  type: "credential";
  accountId: string;
  previousValue: string | null;
};

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
  const exportedAccounts: BackupBundleAccount[] = await Promise.all(
    accounts.map(async (account) => ({
      account,
      credentials: await api.readAccountCredentials(account.id).catch(() => null),
    })),
  );

  const bundle: BackupBundle = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    settings,
    currentAuthJson: await api.readAuthJson().catch(() => null),
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

  const nextAccounts = parsed.accounts
    .map((entry) => entry.account)
    .filter((account): account is Account => Boolean(account?.id && account.displayName));
  const nextAccountIds = new Set(nextAccounts.map((account) => account.id));
  const removedAccounts = existingAccounts.filter((account) => !nextAccountIds.has(account.id));

  const previousCredentials = new Map<string, string | null>();
  const shouldRestoreCurrentAuth =
    Boolean(parsed.currentAuthJson) && nextAccounts.some((account) => account.isActive);
  const previousAuthJson = shouldRestoreCurrentAuth
    ? await api.readAuthJson().catch(() => null)
    : null;

  for (const { account } of parsed.accounts) {
    if (account?.id) {
      previousCredentials.set(
        account.id,
        await api.readAccountCredentials(account.id).catch(() => null),
      );
    }
  }

  const completedOperations: RestoreOperation[] = [];
  let authJsonRestored = false;

  try {
    await sequence(parsed.accounts, async ({ account, credentials }) => {
      if (!account?.id) return;
      if (credentials) {
        await api.saveAccountCredentials(account.id, credentials);
      } else {
        await api.deleteAccountCredentials(account.id).catch(() => undefined);
      }
      completedOperations.push({
        type: "credential",
        accountId: account.id,
        previousValue: previousCredentials.get(account.id) ?? null,
      });
    });

    if (shouldRestoreCurrentAuth && parsed.currentAuthJson) {
      await api.writeAuthJson(parsed.currentAuthJson);
      authJsonRestored = true;
    }

    const hydratedAccounts = await hydrateAccounts(nextAccounts);
    await api.saveAccounts({ version: "1.0", accounts: hydratedAccounts });

    await sequence(removedAccounts, async (account) => {
      await api.deleteAccountCredentials(account.id).catch(() => undefined);
      await api.deleteAccountSessions(account.id).catch(() => undefined);
    });

    return {
      accounts: hydratedAccounts,
      settings: {
        autoRefreshInterval:
          typeof parsed.settings.autoRefreshInterval === "number"
            ? parsed.settings.autoRefreshInterval
            : 0,
        autoRestartCodexAfterSwitch:
          typeof parsed.settings.autoRestartCodexAfterSwitch === "boolean"
            ? parsed.settings.autoRestartCodexAfterSwitch
            : true,
        theme:
          parsed.settings.theme === "light" ||
          parsed.settings.theme === "dark" ||
          parsed.settings.theme === "system"
            ? parsed.settings.theme
            : "system",
        proxyUrl: typeof parsed.settings.proxyUrl === "string" ? parsed.settings.proxyUrl : "",
      },
    };
  } catch (error) {
    await api.saveAccounts({ version: "1.0", accounts: existingAccounts }).catch(() => undefined);

    await sequence(completedOperations, async (op) => {
      if (op.type === "credential") {
        if (op.previousValue) {
          await api.saveAccountCredentials(op.accountId, op.previousValue).catch(() => undefined);
        } else {
          await api.deleteAccountCredentials(op.accountId).catch(() => undefined);
        }
      }
    });

    if (authJsonRestored && previousAuthJson) {
      await api.writeAuthJson(previousAuthJson).catch(() => undefined);
    }

    throw error;
  }
}
