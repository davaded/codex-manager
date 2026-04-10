export type AccountRateLimitStatus = "available" | "invalid" | "unknown";
export type AccountPreheatStatus = "success" | "skipped" | "error";

export interface Account {
  id: string;
  displayName: string;
  email: string | null;
  userId: string | null;
  isActive: boolean;
  createdAt: string;
  lastSwitchedAt: string | null;
  sessionInfo: SessionInfo | null;
  usageLedger?: AccountUsageLedger | null;
  rateLimits?: RateLimitSnapshot | null;
  rateLimitsError?: string | null;
  accountStatus?: AccountRateLimitStatus | null;
  accountStatusReason?: string | null;
  lastPreheatAt?: string | null;
  preheatStatus?: AccountPreheatStatus | null;
  preheatMessage?: string | null;
}

export interface SessionInfo {
  fileCount: number;
  totalBytes: number;
  lastSessionObservedAt: string | null;
  currentSessionId?: string | null;
  currentThreadName?: string | null;
  currentUpdatedAt?: string | null;
}

export interface AccountCredentials {
  accountId: string;
  authJson: string;
}

export interface AccountsStore {
  version: string;
  accounts: Account[];
}

export type SwitchPhase =
  | 'idle'
  | 'preparing'
  | 'writing_auth'
  | 'syncing_state'
  | 'done'
  | 'error';

export interface SwitchState {
  phase: SwitchPhase;
  fromAccountId: string | null;
  toAccountId: string | null;
  error: string | null;
  snapshotResult: SnapshotResult | null;
  restoreResult: RestoreResult | null;
}

export interface SnapshotResult {
  fileCount: number;
  totalBytes: number;
  snapshotTime: string;
}

export interface RestoreResult {
  fileCount: number;
  totalBytes: number;
  restoreTime: string;
}

export interface SwitchResult {
  success: boolean;
  snapshot: SnapshotResult;
  restore: RestoreResult;
  error: string | null;
}

export interface OAuthResult {
  authJson: string;
  email: string | null;
  userId: string | null;
}

export interface AppSettings {
  autoRefreshInterval: number; // minutes, 0 = disabled
  autoPreheatIntervalHours: number; // hours, 0 = disabled
  autoRestartCodexAfterSwitch: boolean;
  theme: 'light' | 'dark' | 'system';
  proxyUrl: string;
}

export interface DesktopPlatformCapabilities {
  platform: string;
  supportsAutoRestartCodexDesktop: boolean;
  supportsResumeSessionInTerminal: boolean;
  supportsSystemTray: boolean;
  supportsTaskbarShortcuts: boolean;
  supportsDockMenu: boolean;
  supportsAppIndicator: boolean;
}

export interface TokenUsageInfo {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface AccountUsageLedger {
  accumulated: TokenUsageInfo;
  segmentStart: TokenUsageInfo | null;
  lastUpdatedAt: string | null;
}

export interface ModelUsageSummary {
  model: string;
  sessions: number;
  totalTokens: number;
}

export interface UsageStatsSummary {
  sessionsAnalyzed: number;
  latestModel: string | null;
  totalTokens: TokenUsageInfo;
  latestTotalTokens: TokenUsageInfo | null;
  models: ModelUsageSummary[];
}

export interface CreditsSnapshot {
  hasCredits?: boolean | null;
  unlimited?: boolean | null;
  balance?: string | null;
}

export interface RateLimitWindow {
  usedPercent: number;
  resetsAt?: number | null;
  windowDurationMins?: number | null;
}

export interface RateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  planType?: string | null;
  credits?: CreditsSnapshot | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
}

export interface GetAccountRateLimitsResponse {
  rateLimits: RateLimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot> | null;
  accountStatus?: AccountRateLimitStatus | null;
  accountStatusReason?: string | null;
}

export interface PreheatAccountResult {
  accountId: string;
  outcome: AccountPreheatStatus;
  message: string;
  checkedAt: string;
  rateLimitResult?: GetAccountRateLimitsResponse | null;
}

export interface PreheatAccountsResponse {
  results: PreheatAccountResult[];
  successCount: number;
  skippedCount: number;
  errorCount: number;
}

export interface BackupBundleAccount {
  account: Account;
  credentials: string | null;
}

export interface BackupBundle {
  version: string;
  exportedAt: string;
  settings: AppSettings;
  currentAuthJson: string | null;
  accounts: BackupBundleAccount[];
}
