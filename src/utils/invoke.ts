import { invoke } from "@tauri-apps/api/core";
import {
  AppSettings,
  AccountsStore,
  DailyWorkspaceUsageResponse,
  DesktopPlatformCapabilities,
  GetAccountRateLimitsResponse,
  OAuthResult,
  RestoreResult,
  SessionInfo,
  SnapshotResult,
  SwitchResult,
  UsageStatsSummary,
} from "../types";

const isTauriRuntime =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

const MOCK_ACCOUNTS_KEY = "codex-manager:mock-accounts";
const MOCK_CREDENTIALS_KEY = "codex-manager:mock-credentials";
const MOCK_AUTH_KEY = "codex-manager:mock-auth";
const MOCK_SETTINGS_KEY = "codex-manager:mock-settings";

const demoAccounts: AccountsStore = {
  version: "1.0",
  accounts: [
    {
      id: "6d4c1b6f-6d4d-4e5f-81f9-08f853dbb0a1",
      displayName: "工作账号（主）",
      email: "dev@company.com",
      userId: "team-dev",
      isActive: true,
      createdAt: "2026-03-09T08:20:00.000Z",
      lastSwitchedAt: "2026-03-18T07:30:00.000Z",
      sessionInfo: {
        fileCount: 42,
        totalBytes: 5_320_000,
        lastSessionObservedAt: "2026-03-18T07:30:00.000Z",
        currentSessionId: "019cfff1-1ca0-7c21-b5f4-7f5a0fc8725a",
        currentThreadName: "复刻界面设计并完善功能",
        currentUpdatedAt: "2026-03-18T07:55:43.7207813Z",
      },
      rateLimits: {
        limitId: "codex",
        planType: "plus",
        primary: { remainingPercent: 100, windowDurationMins: 300, resetsAt: 1773813607 },
        secondary: { remainingPercent: 88, windowDurationMins: 10080, resetsAt: 1773878873 },
      },
    },
    {
      id: "3e72c630-4b00-4dc6-81c1-7086c171f354",
      displayName: "个人备用账号",
      email: "personal@gmail.com",
      userId: "personal-1",
      isActive: false,
      createdAt: "2026-03-02T02:15:00.000Z",
      lastSwitchedAt: "2026-03-17T06:30:00.000Z",
      sessionInfo: {
        fileCount: 8,
        totalBytes: 1_180_000,
        lastSessionObservedAt: "2026-03-18T06:30:00.000Z",
        currentSessionId: null,
        currentThreadName: null,
        currentUpdatedAt: null,
      },
      rateLimits: {
        limitId: "codex",
        planType: "plus",
        primary: { remainingPercent: 19, windowDurationMins: 300, resetsAt: 1773806407 },
        secondary: { remainingPercent: 29, windowDurationMins: 10080, resetsAt: 1774144400 },
      },
    },
    {
      id: "02d1d53a-826f-471a-9aad-c5343b5d0f1d",
      displayName: "测试专用",
      email: "test.bot@company.com",
      userId: "qa-bot",
      isActive: false,
      createdAt: "2026-02-26T04:10:00.000Z",
      lastSwitchedAt: "2026-03-10T01:15:00.000Z",
      sessionInfo: {
        fileCount: 36,
        totalBytes: 4_740_000,
        lastSessionObservedAt: "2026-03-10T01:15:00.000Z",
        currentSessionId: null,
        currentThreadName: null,
        currentUpdatedAt: null,
      },
      rateLimits: {
        limitId: "codex",
        planType: "plus",
        primary: { remainingPercent: 98, windowDurationMins: 300, resetsAt: 1773801007 },
        secondary: { remainingPercent: 96, windowDurationMins: 10080, resetsAt: 1773965273 },
      },
    },
  ],
};

const demoCredentials: Record<string, string> = {
  "6d4c1b6f-6d4d-4e5f-81f9-08f853dbb0a1": '{"profile":"work-main"}',
  "3e72c630-4b00-4dc6-81c1-7086c171f354": '{"profile":"personal-backup"}',
  "02d1d53a-826f-471a-9aad-c5343b5d0f1d": '{"profile":"test-bot"}',
};

const demoSettings: AppSettings = {
  autoRefreshInterval: 0,
  autoRestartCodexAfterSwitch: true,
  autoRestartVscodeAfterSwitch: false,
  theme: "system",
  proxyUrl: "",
};

const mockPlatformCapabilities: DesktopPlatformCapabilities = {
  platform: "browser",
  supportsAutoRestartCodexDesktop: false,
  supportsAutoRestartVscode: false,
  supportsResumeSessionInTerminal: false,
  supportsSystemTray: false,
  supportsTaskbarShortcuts: false,
  supportsDockMenu: false,
  supportsAppIndicator: false,
};

const mockUsageStatsSummary: UsageStatsSummary = {
  sessionsAnalyzed: 18,
  latestModel: "gpt-5-codex",
  totalTokens: {
    inputTokens: 186_420,
    cachedInputTokens: 74_220,
    outputTokens: 28_540,
    reasoningOutputTokens: 12_180,
    totalTokens: 214_960,
  },
  latestTotalTokens: {
    inputTokens: 5_320,
    cachedInputTokens: 2_180,
    outputTokens: 690,
    reasoningOutputTokens: 240,
    totalTokens: 6_010,
  },
  models: [
    { model: "gpt-5-codex", sessions: 11, totalTokens: 138_220 },
    { model: "gpt-5.2", sessions: 5, totalTokens: 58_940 },
    { model: "gpt-4.1", sessions: 2, totalTokens: 17_800 },
  ],
};

const mockDailyWorkspaceUsage: DailyWorkspaceUsageResponse = {
  startDate: "2026-02-17",
  endDate: "2026-03-19",
  data: [
    {
      date: "2026-03-10",
      totals: {
        credits: 5.42,
        turns: 18,
        textTotalTokens: 1_820_000,
      },
    },
    {
      date: "2026-03-11",
      totals: {
        credits: 8.16,
        turns: 27,
        cachedTextInputTokens: 450_000,
        uncachedTextInputTokens: 980_000,
        textOutputTokens: 320_000,
      },
    },
    {
      date: "2026-03-13",
      totals: {
        credits: 12.74,
        turns: 34,
        textTotalTokens: 3_410_000,
      },
    },
    {
      date: "2026-03-15",
      totals: {
        credits: 6.08,
        turns: 21,
        textTotalTokens: 1_990_000,
      },
    },
    {
      date: "2026-03-17",
      totals: {
        credits: 3.95,
        turns: 13,
        textTotalTokens: 960_000,
      },
    },
  ],
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function ensureMockSeed() {
  if (typeof window === "undefined") {
    return;
  }

  if (!window.localStorage.getItem(MOCK_ACCOUNTS_KEY)) {
    writeJson(MOCK_ACCOUNTS_KEY, demoAccounts);
  }
  if (!window.localStorage.getItem(MOCK_CREDENTIALS_KEY)) {
    writeJson(MOCK_CREDENTIALS_KEY, demoCredentials);
  }
  if (!window.localStorage.getItem(MOCK_AUTH_KEY)) {
    window.localStorage.setItem(
      MOCK_AUTH_KEY,
      demoCredentials["6d4c1b6f-6d4d-4e5f-81f9-08f853dbb0a1"],
    );
  }
  if (!window.localStorage.getItem(MOCK_SETTINGS_KEY)) {
    writeJson(MOCK_SETTINGS_KEY, demoSettings);
  }
}

function readMockAccounts(): AccountsStore {
  ensureMockSeed();
  const store = readJson(MOCK_ACCOUNTS_KEY, demoAccounts);
  return {
    ...store,
    accounts: store.accounts.map((account) => ({
      ...account,
      sessionInfo: account.sessionInfo
        ? {
            ...account.sessionInfo,
            lastSessionObservedAt:
              account.sessionInfo.lastSessionObservedAt ??
              (account.sessionInfo as { lastSnapshotAt?: string | null }).lastSnapshotAt ??
              null,
          }
        : null,
    })),
  };
}

function writeMockAccounts(data: AccountsStore) {
  writeJson(MOCK_ACCOUNTS_KEY, data);
}

function readMockCredentials(): Record<string, string> {
  ensureMockSeed();
  return readJson(MOCK_CREDENTIALS_KEY, demoCredentials);
}

function writeMockCredentials(data: Record<string, string>) {
  writeJson(MOCK_CREDENTIALS_KEY, data);
}

function readMockAuth(): string {
  ensureMockSeed();
  return window.localStorage.getItem(MOCK_AUTH_KEY) ?? '{"profile":"work-main"}';
}

function writeMockAuth(content: string) {
  window.localStorage.setItem(MOCK_AUTH_KEY, content);
}

function readMockSettings(): AppSettings {
  ensureMockSeed();
  return {
    ...demoSettings,
    ...readJson(MOCK_SETTINGS_KEY, demoSettings),
  };
}

function writeMockSettings(data: AppSettings) {
  writeJson(MOCK_SETTINGS_KEY, data);
}

function createSnapshotFrom(info: SessionInfo | null | undefined): SnapshotResult {
  return {
    fileCount: info?.fileCount ?? 0,
    totalBytes: info?.totalBytes ?? 0,
    snapshotTime: new Date().toISOString(),
  };
}

function createRestoreFrom(info: SessionInfo | null | undefined): RestoreResult {
  return {
    fileCount: info?.fileCount ?? 0,
    totalBytes: info?.totalBytes ?? 0,
    restoreTime: new Date().toISOString(),
  };
}

const browserApi = {
  async loadAccounts(): Promise<AccountsStore> {
    return readMockAccounts();
  },
  async saveAccounts(data: AccountsStore): Promise<void> {
    writeMockAccounts(data);
  },
  async loadSettings(): Promise<AppSettings> {
    return readMockSettings();
  },
  async getPlatformCapabilities(): Promise<DesktopPlatformCapabilities> {
    return mockPlatformCapabilities;
  },
  async saveSettings(data: AppSettings): Promise<void> {
    writeMockSettings(data);
  },
  async readAuthJson(): Promise<string> {
    return readMockAuth();
  },
  async writeAuthJson(content: string): Promise<void> {
    writeMockAuth(content);
  },
  async saveAccountCredentials(accountId: string, content: string): Promise<void> {
    const credentials = readMockCredentials();
    credentials[accountId] = content;
    writeMockCredentials(credentials);
  },
  async readAccountCredentials(accountId: string): Promise<string> {
    const credentials = readMockCredentials();
    if (!credentials[accountId]) {
      throw new Error(`Credentials not found for ${accountId}`);
    }
    return credentials[accountId];
  },
  async deleteAccountCredentials(accountId: string): Promise<void> {
    const credentials = readMockCredentials();
    delete credentials[accountId];
    writeMockCredentials(credentials);
  },
  async snapshotSessions(accountId: string): Promise<SnapshotResult> {
    const store = readMockAccounts();
    const account = store.accounts.find((item) => item.id === accountId);
    const snapshot = createSnapshotFrom(account?.sessionInfo);
    return snapshot;
  },
  async restoreSessions(accountId: string): Promise<RestoreResult> {
    const store = readMockAccounts();
    const account = store.accounts.find((item) => item.id === accountId);
    return createRestoreFrom(account?.sessionInfo);
  },
  async switchAccount(
    fromId: string | null,
    toId: string,
    toAuth: string,
  ): Promise<SwitchResult> {
    const store = readMockAccounts();
    const fromAccount = fromId ? store.accounts.find((item) => item.id === fromId) : null;
    const liveSessionInfo =
      store.accounts.find((item) => item.isActive)?.sessionInfo ??
      fromAccount?.sessionInfo ?? {
        fileCount: 0,
        totalBytes: 0,
        lastSessionObservedAt: null,
        currentSessionId: null,
        currentThreadName: null,
        currentUpdatedAt: null,
      };
    const snapshot = createSnapshotFrom(liveSessionInfo);
    const restore = createRestoreFrom(liveSessionInfo);
    const now = new Date().toISOString();

    const nextAccounts = store.accounts.map((account) => ({
      ...account,
      isActive: account.id === toId,
      lastSwitchedAt: account.id === toId ? now : account.lastSwitchedAt,
      sessionInfo:
        account.id === toId
          ? {
              fileCount: restore.fileCount,
              totalBytes: restore.totalBytes,
              lastSessionObservedAt: restore.restoreTime,
              currentSessionId: liveSessionInfo.currentSessionId ?? null,
              currentThreadName: liveSessionInfo.currentThreadName ?? null,
              currentUpdatedAt: liveSessionInfo.currentUpdatedAt ?? null,
            }
          : account.id === fromId
          ? {
              fileCount: snapshot.fileCount,
              totalBytes: snapshot.totalBytes,
              lastSessionObservedAt: snapshot.snapshotTime,
              currentSessionId: liveSessionInfo.currentSessionId ?? null,
              currentThreadName: liveSessionInfo.currentThreadName ?? null,
              currentUpdatedAt: liveSessionInfo.currentUpdatedAt ?? null,
            }
          : account.sessionInfo,
    }));

    writeMockAccounts({ ...store, accounts: nextAccounts });
    writeMockAuth(toAuth);

    return {
      success: true,
      snapshot,
      restore,
      error: null,
    };
  },
  async listAccountSessionInfo(accountId: string): Promise<SessionInfo | null> {
    const store = readMockAccounts();
    return store.accounts.find((item) => item.id === accountId)?.sessionInfo ?? null;
  },
  async readAccountRateLimits(accountId: string): Promise<GetAccountRateLimitsResponse> {
    const store = readMockAccounts();
    const account = store.accounts.find((item) => item.id === accountId) ?? null;
    return {
      rateLimits: account?.rateLimits ?? null,
      rateLimitsByLimitId:
        account?.rateLimits?.limitId
          ? { [account.rateLimits.limitId]: account.rateLimits }
          : null,
      accountStatus: account?.accountStatus ?? (account?.rateLimits ? "available" : "unknown"),
      accountStatusReason: account?.accountStatusReason ?? null,
    };
  },
  async getCurrentSessionsInfo(): Promise<SessionInfo> {
    const store = readMockAccounts();
    return (
      store.accounts.find((item) => item.isActive)?.sessionInfo ?? {
        fileCount: 0,
        totalBytes: 0,
        lastSessionObservedAt: null,
        currentSessionId: null,
        currentThreadName: null,
        currentUpdatedAt: null,
      }
    );
  },
  async readUsageStatsSummary(): Promise<UsageStatsSummary> {
    return mockUsageStatsSummary;
  },
  async readAccountDailyWorkspaceUsage(
    _accountId: string,
    _days = 30,
  ): Promise<DailyWorkspaceUsageResponse> {
    return mockDailyWorkspaceUsage;
  },
  async deleteAccountSessions(accountId: string): Promise<void> {
    const store = readMockAccounts();
    writeMockAccounts({
      ...store,
      accounts: store.accounts.map((account) =>
        account.id === accountId ? { ...account, sessionInfo: null } : account,
      ),
    });
  },
  async resumeSessionInTerminal(_sessionId: string): Promise<void> {
    return;
  },
  async restartCodexDesktop(): Promise<void> {
    return;
  },
  async restartVscode(): Promise<void> {
    return;
  },
  async startOauthFlow(): Promise<OAuthResult> {
    const stamp = Date.now().toString().slice(-5);
    return {
      authJson: `{"profile":"browser-mock-${stamp}"}`,
      email: `new.account.${stamp}@example.com`,
      userId: `mock-${stamp}`,
    };
  },
  async cancelOauthFlow(): Promise<void> {
    return;
  },
  async getCodexDir(): Promise<string> {
    return "~/.codex";
  },
  async getSessionsDir(): Promise<string> {
    return "~/.codex/sessions";
  },
  async getAccountSessionsDir(accountId: string): Promise<string> {
    return `~/.codex-manager/mock-sessions/${accountId}`;
  },
};

export const api = isTauriRuntime
  ? {
      // accounts
      loadAccounts: () => invoke<AccountsStore>("load_accounts"),
      saveAccounts: (data: AccountsStore) => invoke<void>("save_accounts", { data }),
      loadSettings: () => invoke<AppSettings>("load_settings"),
      getPlatformCapabilities: () =>
        invoke<DesktopPlatformCapabilities>("get_platform_capabilities"),
      saveSettings: (data: AppSettings) => invoke<void>("save_settings", { data }),
      readAuthJson: () => invoke<string>("read_auth_json"),
      writeAuthJson: (content: string) => invoke<void>("write_auth_json", { content }),
      saveAccountCredentials: (accountId: string, content: string) =>
        invoke<void>("save_account_credentials", { accountId, content }),
      readAccountCredentials: (accountId: string) =>
        invoke<string>("read_account_credentials", { accountId }),
      deleteAccountCredentials: (accountId: string) =>
        invoke<void>("delete_account_credentials", { accountId }),

      // sessions
      snapshotSessions: (accountId: string) =>
        invoke<SnapshotResult>("snapshot_sessions", { accountId }),
      restoreSessions: (accountId: string) =>
        invoke<RestoreResult>("restore_sessions", { accountId }),
      switchAccount: (fromId: string | null, toId: string, toAuth: string) =>
        invoke<SwitchResult>("switch_account", { fromId, toId, toAuth }),
      listAccountSessionInfo: (accountId: string) =>
        invoke<SessionInfo | null>("list_account_session_info", { accountId }),
      readAccountRateLimits: (accountId: string) =>
        invoke<GetAccountRateLimitsResponse>("read_account_rate_limits", { accountId }),
      getCurrentSessionsInfo: () => invoke<SessionInfo>("get_current_sessions_info"),
      readUsageStatsSummary: () => invoke<UsageStatsSummary>("read_usage_stats_summary"),
      readAccountDailyWorkspaceUsage: (accountId: string, days = 30) =>
        invoke<DailyWorkspaceUsageResponse>("read_account_daily_workspace_usage", {
          accountId,
          days,
        }),
      deleteAccountSessions: (accountId: string) =>
        invoke<void>("delete_account_sessions", { accountId }),
      resumeSessionInTerminal: (sessionId: string) =>
        invoke<void>("resume_session_in_terminal", { sessionId }),
      restartCodexDesktop: () => invoke<void>("restart_codex_desktop"),
      restartVscode: () => invoke<void>("restart_vscode"),

      // oauth
      startOauthFlow: () => invoke<OAuthResult>("start_oauth_flow"),
      cancelOauthFlow: () => invoke<void>("cancel_oauth_flow"),

      // paths
      getCodexDir: () => invoke<string>("get_codex_dir"),
      getSessionsDir: () => invoke<string>("get_sessions_dir"),
      getAccountSessionsDir: (accountId: string) =>
        invoke<string>("get_account_sessions_dir", { accountId }),
    }
  : browserApi;
