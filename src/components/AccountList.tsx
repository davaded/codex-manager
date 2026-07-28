import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { useAccountStore } from "../store/accountStore";
import { Account } from "../types";
import AccountCard from "./AccountCard";
import EmptyState from "./EmptyState";
import {
  getAccountPreheatInsight,
  getAccountStatusReason,
  getAccountInsight,
  getRecommendedAccountId,
  hasActiveWeeklyWindow,
  isAccountInvalid,
} from "../utils/dashboard";
import { revealUp } from "../utils/motion";

interface AccountListProps {
  isPreheating: boolean;
  isRefreshing: boolean;
  refreshingAccountIds: string[];
  onDelete: (id: string) => void;
  onPreheatAccounts: () => Promise<void>;
  onRefreshAccount: (id: string) => Promise<void>;
  onRefreshUsage: () => Promise<void>;
  onRename: (id: string, displayName: string) => Promise<void>;
  onSwitch: (account: Account) => void;
}

const AccountList: React.FC<AccountListProps> = ({
  isPreheating,
  isRefreshing,
  refreshingAccountIds,
  onDelete,
  onPreheatAccounts,
  onRefreshAccount,
  onRefreshUsage,
  onRename,
  onSwitch,
}) => {
  const { accounts, setAddModalOpen, switchState } = useAccountStore();
  const prefersReducedMotion = useReducedMotion() ?? false;

  if (accounts.length === 0) {
    return <EmptyState onAdd={() => setAddModalOpen(true)} />;
  }

  const sorted = [...accounts].sort((a, b) => {
    if (a.isActive) return -1;
    if (b.isActive) return 1;
    const da = a.lastSwitchedAt ? new Date(a.lastSwitchedAt).getTime() : 0;
    const db = b.lastSwitchedAt ? new Date(b.lastSwitchedAt).getTime() : 0;
    return db - da;
  });
  const recommendedId = getRecommendedAccountId(sorted);
  const featuredAccount =
    sorted.find((account) => account.isActive) ??
    sorted.find((account) => account.id === recommendedId) ??
    sorted[0];
  const standbyAccounts = sorted.filter((account) => account.id !== featuredAccount?.id);
  const recommendedStandby = sorted.find(
    (account) => account.id === recommendedId && account.id !== featuredAccount?.id,
  );
  const featuredIdentity =
    featuredAccount?.email ?? featuredAccount?.userId ?? "未识别身份";
  const featuredInsight = featuredAccount ? getAccountInsight(featuredAccount) : null;
  const featuredHourlyRemaining =
    typeof featuredInsight?.hourlyQuota.percent === "number"
      ? Math.max(0, Math.min(100, Math.round(featuredInsight.hourlyQuota.percent)))
      : null;
  const featuredHourlyUsed =
    typeof featuredAccount?.rateLimits?.primary?.usedPercent === "number"
      ? Math.max(0, Math.min(100, Math.round(featuredAccount.rateLimits.primary.usedPercent)))
      : null;
  const featuredWeeklyRemaining =
    typeof featuredInsight?.weeklyQuota.percent === "number"
      ? Math.max(0, Math.min(100, Math.round(featuredInsight.weeklyQuota.percent)))
      : null;
  const featuredWeeklyUsed =
    typeof featuredAccount?.rateLimits?.secondary?.usedPercent === "number"
      ? Math.max(0, Math.min(100, Math.round(featuredAccount.rateLimits.secondary.usedPercent)))
      : null;
  const featuredPreheat = featuredAccount ? getAccountPreheatInsight(featuredAccount) : null;
  const featuredInvalid = featuredAccount ? isAccountInvalid(featuredAccount) : false;
  const recommendedStandbyInsight = recommendedStandby ? getAccountInsight(recommendedStandby) : null;
  const recommendedStandbySummary =
    !recommendedStandbyInsight
      ? null
      : recommendedStandbyInsight.weeklyQuota.valueLabel === recommendedStandbyInsight.hourlyQuota.valueLabel
        ? `5H / 本周均为 ${recommendedStandbyInsight.hourlyQuota.valueLabel}`
        : `5H ${recommendedStandbyInsight.hourlyQuota.valueLabel} · 本周 ${recommendedStandbyInsight.weeklyQuota.valueLabel}`;
  const isSwitching = switchState.phase !== "idle";
  const isSwitchTarget =
    featuredAccount && switchState.toAccountId === featuredAccount.id && isSwitching;
  const featuredStatus = featuredInvalid
    ? featuredAccount?.isActive
      ? "当前已失效"
      : "已失效"
    : featuredAccount?.isActive
      ? "当前"
      : isSwitchTarget
        ? "切换中"
        : "待命";
  const featuredHourlyHealth =
    featuredHourlyRemaining === null
      ? "待同步"
      : featuredHourlyRemaining <= 15
        ? "偏紧"
        : featuredHourlyRemaining <= 45
          ? "可控"
          : "充足";
  const featuredWeeklyHealth =
    featuredWeeklyRemaining === null
      ? "待同步"
      : featuredWeeklyRemaining <= 15
        ? "偏紧"
        : featuredWeeklyRemaining <= 45
          ? "可控"
          : "充足";
  const standbyInvalidCount = standbyAccounts.filter((account) => isAccountInvalid(account)).length;
  const standbyAvailableCount = standbyAccounts.length - standbyInvalidCount;
  const standbyWeeklyReadyCount = standbyAccounts.filter((account) => {
    if (isAccountInvalid(account)) {
      return false;
    }

    return hasActiveWeeklyWindow(account);
  }).length;

  return (
    <section className="mx-auto w-full max-w-[1380px] space-y-4">
      {featuredAccount && (
        <div className="grid gap-4">
          <motion.article
            className="relative overflow-hidden rounded-[34px] border border-[#dad4c8] bg-[linear-gradient(135deg,#fffdf9_0%,#fff7ea_38%,#84e7a5_100%)] px-5 py-5 text-slate-950 shadow-[rgba(0,0,0,0.1)_0px_1px_1px,rgba(0,0,0,0.04)_0px_-1px_1px_inset,rgba(0,0,0,0.05)_0px_-0.5px_1px,rgba(80,62,30,0.16)_0px_26px_50px_-30px] sm:px-6"
            {...revealUp(prefersReducedMotion, 0.04)}
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.72),transparent_66%)]" />
              <div className="absolute -right-16 top-8 h-52 w-52 rounded-full bg-[#3bd3fd]/25 blur-3xl" />
              <div className="absolute -left-12 bottom-6 h-48 w-48 rounded-full bg-[#fc7981]/18 blur-3xl" />
            </div>

            <div className="relative flex flex-col gap-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                    Current
                  </span>
                  <div className="mt-3 flex flex-wrap items-center gap-2.5">
                    <h2 className="truncate text-[1.78rem] font-black tracking-[-0.06em] text-slate-950 sm:text-[2rem]">
                      {featuredAccount.displayName}
                    </h2>
                    <span className="rounded-full border border-dashed border-[#dad4c8] bg-white/75 px-3 py-1 font-['Space_Mono'] text-[10px] font-semibold text-[#55534e]">
                      {featuredStatus}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#55534e]">
                    <span className="rounded-full border border-dashed border-[#dad4c8] bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-950">
                      {featuredInsight?.roleLabel ?? "账号"}
                    </span>
                    <span className="truncate">{featuredIdentity}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={onPreheatAccounts}
                    disabled={isPreheating}
                    className="rounded-full border border-[#d08a11] bg-[#f8cc65] px-3.25 py-1.75 text-[13px] font-semibold text-slate-950 shadow-[rgba(0,0,0,0.1)_0px_1px_1px,rgba(0,0,0,0.04)_0px_-1px_1px_inset] transition-all hover:-translate-y-0.5 hover:rotate-[-4deg] hover:shadow-[rgb(0,0,0)_-7px_7px] disabled:opacity-60"
                  >
                    {isPreheating ? "预热中..." : "一键预热"}
                  </button>
                  <button
                    onClick={onRefreshUsage}
                    disabled={isRefreshing}
                    className="rounded-full border border-dashed border-[#dad4c8] bg-white/82 px-3.25 py-1.75 text-[13px] font-semibold text-slate-950 transition-all hover:-translate-y-0.5 hover:rotate-[-3deg] hover:shadow-[rgb(0,0,0)_-7px_7px] disabled:opacity-60"
                  >
                    {isRefreshing ? "刷新中..." : "刷新全部用量"}
                  </button>
                  <button
                    onClick={() => setAddModalOpen(true)}
                    className="rounded-full border border-dashed border-[#dad4c8] bg-white px-3.25 py-1.75 text-[13px] font-semibold text-slate-950 shadow-[rgba(0,0,0,0.1)_0px_1px_1px,rgba(0,0,0,0.04)_0px_-1px_1px_inset] transition-all hover:-translate-y-0.5 hover:rotate-[3deg] hover:shadow-[rgb(0,0,0)_-7px_7px]"
                  >
                    添加账户
                  </button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.16fr)_290px]">
                <div className="rounded-[28px] border border-[#e2dccf] bg-white/56 px-5 py-5 shadow-[rgba(255,255,255,0.35)_0px_1px_0px_inset,rgba(80,62,30,0.08)_0px_22px_40px_-34px] backdrop-blur-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 px-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                        额度与用量
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-500">
                      <span className="rounded-full border border-dashed border-[#e2dccf] bg-white/48 px-3 py-1.5">
                        预热 · {featuredPreheat?.label ?? "未预热"}
                      </span>
                      <span className="rounded-full border border-dashed border-[#e2dccf] bg-white/44 px-3 py-1.5">
                        状态 · {featuredStatus}
                      </span>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] lg:items-start">
                    <section className="min-w-0 px-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                            5H 剩余
                          </p>
                          <div className="mt-4">
                            <p className="text-[3.15rem] leading-none font-black tracking-[-0.09em] text-slate-950 sm:text-[3.45rem]">
                              {featuredHourlyRemaining === null ? "--" : `${featuredHourlyRemaining}%`}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-full border border-dashed border-[#e2dccf] bg-white/48 px-3 py-1.5 text-[10px] font-semibold tracking-[0.18em] text-[#6b675f]">
                          {featuredHourlyHealth}
                        </span>
                      </div>
                      <p className="mt-4 text-sm text-[#55534e]">
                        {featuredInsight?.hourlyQuota.detail ?? "等待同步"}
                      </p>
                      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#ebe5da]">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,#f8cc65_0%,#fc7981_100%)] transition-all"
                          style={{
                            width: featuredHourlyRemaining === null ? "22%" : `${featuredHourlyRemaining}%`,
                          }}
                        />
                      </div>
                      <div className="mt-2.5 flex items-center justify-between text-[11px] font-medium text-slate-500">
                        <span>短期窗口</span>
                        <span>{featuredHourlyUsed === null ? "已用 --" : `已用 ${featuredHourlyUsed}%`}</span>
                      </div>
                    </section>

                    <div className="hidden h-full w-px bg-[linear-gradient(180deg,rgba(218,212,200,0),rgba(218,212,200,0.9),rgba(218,212,200,0))] lg:block" />

                    <section className="min-w-0 px-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                            本周剩余
                          </p>
                          <div className="mt-4">
                            <p className="text-[3.15rem] leading-none font-black tracking-[-0.09em] text-slate-950 sm:text-[3.45rem]">
                              {featuredWeeklyRemaining === null ? "--" : `${featuredWeeklyRemaining}%`}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-full border border-dashed border-[#e2dccf] bg-white/48 px-3 py-1.5 text-[10px] font-semibold tracking-[0.18em] text-[#6b675f]">
                          {featuredWeeklyHealth}
                        </span>
                      </div>
                      <p className="mt-4 text-sm text-[#55534e]">
                        {featuredInsight?.weeklyQuota.detail ?? "等待同步"}
                      </p>
                      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#e6efe7]">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,#84e7a5_0%,#3bd3fd_100%)] transition-all"
                          style={{
                            width: featuredWeeklyRemaining === null ? "24%" : `${featuredWeeklyRemaining}%`,
                          }}
                        />
                      </div>
                      <div className="mt-2.5 flex items-center justify-between text-[11px] font-medium text-slate-500">
                        <span>每周窗口</span>
                        <span>{featuredWeeklyUsed === null ? "已用 --" : `已用 ${featuredWeeklyUsed}%`}</span>
                      </div>
                    </section>
                  </div>

                  {!featuredInsight?.hasRealRateLimits && (
                    <div
                      className={`mt-4 rounded-[20px] px-3.5 py-3 text-[12px] leading-5 ${
                        featuredInvalid
                          ? "border border-rose-200 bg-rose-50/90 text-rose-700"
                          : "border border-amber-200 bg-amber-50/90 text-amber-700"
                      }`}
                    >
                      {featuredInvalid
                        ? `检测到账号失效 · ${getAccountStatusReason(featuredAccount) ?? "请重新登录该账号"}`
                        : featuredAccount.rateLimitsError
                          ? `读取失败 · ${featuredAccount.rateLimitsError}`
                          : "当前还没有拿到官方额度数据。"}
                    </div>
                  )}

                  <div className="mt-6 flex flex-col gap-3 border-t border-dashed border-[#dad4c8] px-1 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5 text-sm text-[#55534e]">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          featuredInvalid
                            ? "bg-rose-500"
                            : featuredAccount.isActive
                              ? "bg-emerald-500"
                              : isSwitchTarget
                                ? "animate-pulse bg-amber-500"
                                : "bg-slate-400"
                        }`}
                      />
                      <span className="font-semibold text-slate-950">
                        {featuredInvalid
                          ? "账号失效"
                          : featuredAccount.isActive
                            ? "当前使用中"
                            : isSwitchTarget
                              ? "正在切换到该账号"
                              : "待命中"}
                      </span>
                      <span className="truncate text-[#55534e]">
                        {featuredInvalid
                          ? getAccountStatusReason(featuredAccount) ?? "请重新登录该账号"
                          : `最近同步 ${featuredInsight?.syncLabel ?? "--"}`}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      {!featuredAccount.isActive && !featuredInvalid && (
                        <button
                          onClick={() => !isSwitching && onSwitch(featuredAccount)}
                          disabled={isSwitching}
                          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_18px_32px_-24px_rgba(15,23,42,0.4)] transition-all hover:-translate-y-0.5 disabled:bg-slate-800/60"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.8}
                              d="M13 7l5 5m0 0l-5 5m5-5H6"
                            />
                          </svg>
                          {isSwitchTarget ? "切换中..." : "切换到此账号"}
                        </button>
                      )}
                      <button
                        onClick={() => void onRefreshAccount(featuredAccount.id)}
                        disabled={refreshingAccountIds.includes(featuredAccount.id) || isRefreshing}
                        className="inline-flex items-center gap-2 rounded-full border border-[#d9d2c4] bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-950 shadow-[rgba(0,0,0,0.08)_0px_1px_1px,rgba(0,0,0,0.04)_0px_-1px_1px_inset] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_28px_-24px_rgba(15,23,42,0.35)] disabled:opacity-60"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.8}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        刷新
                      </button>
                      <button
                        onClick={() => onDelete(featuredAccount.id)}
                        className="inline-flex items-center gap-2 rounded-full border border-[#ead2cf] bg-[#fff8f7] px-3.5 py-2.5 text-sm font-semibold text-[#8a4a45] shadow-[rgba(0,0,0,0.06)_0px_1px_1px,rgba(0,0,0,0.04)_0px_-1px_1px_inset] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_28px_-24px_rgba(138,74,69,0.32)]"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.8}
                            d="M6 7h12m-9 0V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v11m4-11v11m5-11v11a2 2 0 01-2 2H8a2 2 0 01-2-2V7h12z"
                          />
                        </svg>
                        删除
                      </button>
                    </div>
                  </div>
                </div>

                <aside className="rounded-[26px] border border-dashed border-[#dad4c8] bg-white/80 px-4 py-4 shadow-[rgba(255,255,255,0.35)_0px_1px_0px_inset]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                    队列与调度
                  </p>

                  <div className="mt-3 rounded-[22px] border border-dashed border-[#dad4c8] bg-[#fffaf1] px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                          下一位
                        </p>
                        <p className="mt-2 text-[1.18rem] font-black tracking-[-0.05em] text-slate-950">
                          {recommendedStandby?.displayName ?? "继续当前账号"}
                        </p>
                      </div>
                      <div className="rounded-[18px] border border-dashed border-[#dad4c8] bg-white/82 px-3 py-2 text-right">
                        <p className="font-['Space_Mono'] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                          待命
                        </p>
                        <p className="mt-1 text-2xl font-black tracking-[-0.06em] text-slate-950">
                          {standbyAccounts.length}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {recommendedStandby && (
                        <>
                          <span className="rounded-full border border-dashed border-[#cbe7d4] bg-emerald-50/78 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                            优先
                          </span>
                          <span className="text-[11px] font-medium text-slate-600">
                            {recommendedStandbySummary ?? "--"}
                          </span>
                        </>
                      )}
                    </div>

                    {!recommendedStandby && (
                      <div className="mt-4 border-t border-dashed border-[#dad4c8] pt-3 text-sm font-semibold text-slate-500">
                        暂无接力账号
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-3 border-t border-dashed border-[#dad4c8] pt-3">
                    <div className="px-2 text-center">
                      <p className="font-['Space_Mono'] text-[9px] uppercase tracking-[0.18em] text-slate-500">
                        可用
                      </p>
                      <p className="mt-1.5 text-[1.05rem] font-bold tracking-[-0.04em] text-slate-900">
                        {standbyAvailableCount}
                      </p>
                    </div>
                    <div className="border-l border-r border-dashed border-[#dad4c8] px-2 text-center">
                      <p className="font-['Space_Mono'] text-[9px] uppercase tracking-[0.18em] text-slate-500">
                        周窗
                      </p>
                      <p className="mt-1.5 text-[1.05rem] font-bold tracking-[-0.04em] text-slate-900">
                        {standbyWeeklyReadyCount}
                      </p>
                    </div>
                    <div className="px-2 text-center">
                      <p className="font-['Space_Mono'] text-[9px] uppercase tracking-[0.18em] text-slate-500">
                        失效
                      </p>
                      <p className="mt-1.5 text-[1.05rem] font-bold tracking-[-0.04em] text-slate-900">
                        {standbyInvalidCount}
                      </p>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </motion.article>
        </div>
      )}

      <motion.section
        className="apple-panel-muted rounded-[30px] p-4 sm:p-4.5"
        {...revealUp(prefersReducedMotion, 0.14)}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 pb-3">
          <div>
            <p className="section-kicker">Standby</p>
            <h3 className="mt-1 text-[1.1rem] font-black tracking-[-0.04em] text-slate-950">
              待命队列
            </h3>
          </div>
          <span className="text-sm font-medium text-slate-500">{standbyAccounts.length} 个账号</span>
        </div>

        <div className="mt-4 space-y-2.5">
          {standbyAccounts.map((account, index) => (
            <motion.div
              key={account.id}
              {...revealUp(prefersReducedMotion, 0.02 * index)}
            >
              <AccountCard
                account={account}
                isRecommended={account.id === recommendedId}
                isRefreshing={isRefreshing}
                isRefreshingSelf={refreshingAccountIds.includes(account.id)}
                onDelete={onDelete}
                onRefresh={() => onRefreshAccount(account.id)}
                onRename={onRename}
                onSwitch={onSwitch}
                variant="compact"
              />
            </motion.div>
          ))}

          {standbyAccounts.length === 0 && (
            <div className="apple-panel-muted rounded-[24px] px-5 py-7 text-center text-sm text-slate-500">
              当前还没有待命账号。
            </div>
          )}
        </div>
      </motion.section>
    </section>
  );
};

export default AccountList;
