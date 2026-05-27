import { describe, expect, it } from "vitest";
import { collectBackupCredentialsForImport } from "../src/utils/backup";
import { Account, BackupBundle } from "../src/types";

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "73fb88a8-8637-4950-ac0c-2a4f9fc89930",
    displayName: "Imported Account",
    email: "imported@example.com",
    userId: "acct-imported",
    isActive: false,
    createdAt: "2026-05-11T00:00:00.000Z",
    lastSwitchedAt: null,
    sessionInfo: null,
    ...overrides,
  };
}

function createBundle(account: Account, credentials: string | null): BackupBundle {
  return {
    version: "1.0",
    exportedAt: "2026-05-11T00:00:00.000Z",
    settings: {
      autoRefreshInterval: 0,
      autoRestartCodexAfterSwitch: true,
      autoRestartVscodeAfterSwitch: false,
      theme: "system",
      proxyUrl: "",
    },
    currentAuthJson: null,
    accounts: [{ account, credentials }],
  };
}

describe("backup import credentials", () => {
  it("rejects account entries without credentials", () => {
    const bundle = createBundle(createAccount(), null);

    expect(() => collectBackupCredentialsForImport(bundle)).toThrow(
      "备份缺少账号凭据：Imported Account",
    );
  });

  it("uses current auth for the active matching account", () => {
    const account = createAccount({ isActive: true });
    const currentAuthJson = JSON.stringify({ tokens: { account_id: account.userId } });
    const bundle = {
      ...createBundle(account, null),
      currentAuthJson,
    };

    expect(collectBackupCredentialsForImport(bundle).get(account.id)).toBe(currentAuthJson);
  });
});
