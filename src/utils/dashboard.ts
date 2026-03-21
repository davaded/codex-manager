import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Account } from "../types";

export interface QuotaMetric {
  label: string;
  percent: number | null;
  detail: string;
  valueLabel: string;
  tone: "critical" | "warning" | "healthy";
  available: boolean;
}

export interface AccountInsight {
  roleLabel: string;
  roleTone: "plus" | "pro" | "team" | "enterprise" | "business" | "free" | "unknown";
  hourlyQuota: QuotaMetric;
  weeklyQuota: QuotaMetric;
  syncLabel: string;
  hasRealRateLimits: boolean;
}

interface RankedQuotaAccount {
  account: Account;
  primaryUsed: number;
  secondaryUsed: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function metricTone(percent: number): QuotaMetric["tone"] {
  if (percent >= 85) return "critical";
  if (percent >= 55) return "warning";
  return "healthy";
}

function formatResetTimestamp(timestampSeconds: number | null | undefined): string {
  if (!timestampSeconds) {
    return "时间待定";
  }

  try {
    return format(new Date(timestampSeconds * 1000), "yyyy-MM-dd HH:mm");
  } catch {
    return "时间待定";
  }
}

function formatSyncTime(iso: string | null): string {
  if (!iso) {
    return "暂无同步记录";
  }

  try {
    const date = new Date(iso);
    if (isToday(date)) {
      return `今天 ${format(date, "HH:mm")}`;
    }
    if (isYesterday(date)) {
      return `昨天 ${format(date, "HH:mm")}`;
    }
    return format(date, "yyyy-MM-dd HH:mm");
  } catch {
    return "时间未知";
  }
}

function deriveRole(account: Account): Pick<AccountInsight, "roleLabel" | "roleTone"> {
  const normalized = account.rateLimits?.planType?.trim().toLowerCase() ?? "";

  switch (normalized) {
    case "plus":
      return { roleLabel: "Plus", roleTone: "plus" };
    case "pro":
      return { roleLabel: "Pro", roleTone: "pro" };
    case "team":
      return { roleLabel: "Team", roleTone: "team" };
    case "enterprise":
      return { roleLabel: "Enterprise", roleTone: "enterprise" };
    case "business":
      return { roleLabel: "Business", roleTone: "business" };
    case "free":
      return { roleLabel: "Free", roleTone: "free" };
    default:
      return { roleLabel: "Unknown", roleTone: "unknown" };
  }
}

function createUnavailableMetric(label: string, suffix: string): QuotaMetric {
  return {
    label,
    percent: null,
    detail: "官方数据未获取",
    valueLabel: `未获取 / ${suffix}`,
    tone: "warning",
    available: false,
  };
}

function deriveHourlyQuota(account: Account): QuotaMetric {
  if (account.rateLimits?.primary) {
    const percent = clamp(account.rateLimits.primary.usedPercent, 0, 100);
    return {
      label: "5小时已使用配额",
      percent,
      detail: `刷新时间 ${formatResetTimestamp(account.rateLimits.primary.resetsAt)}`,
      valueLabel: `${percent}% / 5h`,
      tone: metricTone(percent),
      available: true,
    };
  }

  return createUnavailableMetric("5小时已使用配额", "5h");
}

function deriveWeeklyQuota(account: Account): QuotaMetric {
  if (account.rateLimits?.secondary) {
    const percent = clamp(account.rateLimits.secondary.usedPercent, 0, 100);
    return {
      label: "每周已使用配额",
      percent,
      detail: `刷新时间 ${formatResetTimestamp(account.rateLimits.secondary.resetsAt)}`,
      valueLabel: `${percent}% / week`,
      tone: metricTone(percent),
      available: true,
    };
  }

  return createUnavailableMetric("每周已使用配额", "week");
}

export function getAccountInsight(account: Account): AccountInsight {
  const role = deriveRole(account);
  const hourlyQuota = deriveHourlyQuota(account);
  const weeklyQuota = deriveWeeklyQuota(account);
  const syncSource = account.isActive
    ? account.lastSwitchedAt ?? account.createdAt
    : account.sessionInfo?.lastSnapshotAt ?? account.lastSwitchedAt ?? account.createdAt;

  return {
    ...role,
    hourlyQuota,
    weeklyQuota,
    syncLabel: account.isActive ? "刚刚 (实时)" : formatSyncTime(syncSource),
    hasRealRateLimits: Boolean(account.rateLimits?.primary || account.rateLimits?.secondary),
  };
}

export function shouldShowTeamAccountId(account: Account): boolean {
  const role = deriveRole(account);
  return Boolean(account.accountId && role.roleTone === "team");
}

function getRankedQuotaAccounts(accounts: Account[]): RankedQuotaAccount[] {
  return accounts
    .filter(
      (account) =>
        typeof account.rateLimits?.primary?.usedPercent === "number" ||
        typeof account.rateLimits?.secondary?.usedPercent === "number",
    )
    .map((account) => ({
      account,
      primaryUsed:
        typeof account.rateLimits?.primary?.usedPercent === "number"
          ? clamp(account.rateLimits.primary.usedPercent, 0, 100)
          : Number.POSITIVE_INFINITY,
      secondaryUsed:
        typeof account.rateLimits?.secondary?.usedPercent === "number"
          ? clamp(account.rateLimits.secondary.usedPercent, 0, 100)
          : Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => {
      if (left.primaryUsed !== right.primaryUsed) {
        return left.primaryUsed - right.primaryUsed;
      }
      if (left.secondaryUsed !== right.secondaryUsed) {
        return left.secondaryUsed - right.secondaryUsed;
      }
      return left.account.createdAt.localeCompare(right.account.createdAt);
    });
}

export function getRecommendedAccountId(accounts: Account[]): string | null {
  return (
    getRankedQuotaAccounts(accounts)
      .find(({ account }) => !account.isActive)
      ?.account.id ?? null
  );
}

export function getBestQuotaAccount(accounts: Account[]): Account | null {
  return getRankedQuotaAccounts(accounts)[0]?.account ?? null;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) {
    return "暂无记录";
  }

  try {
    return formatDistanceToNowStrict(new Date(iso), {
      addSuffix: true,
      locale: zhCN,
    });
  } catch {
    return "暂无记录";
  }
}
