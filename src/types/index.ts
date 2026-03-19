export interface Account {
  id: string;
  displayName: string;
  email: string | null;
  userId: string | null;
  isActive: boolean;
  createdAt: string;
  lastSwitchedAt: string | null;
  sessionInfo: SessionInfo | null;
  rateLimits?: RateLimitSnapshot | null;
  rateLimitsError?: string | null;
}

export interface SessionInfo {
  fileCount: number;
  totalBytes: number;
  lastSnapshotAt: string | null;
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
  | 'snapshotting'
  | 'restoring'
  | 'writing_auth'
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
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot> | null;
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
