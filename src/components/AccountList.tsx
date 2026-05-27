import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { useAccountStore } from "../store/accountStore";
import { Account } from "../types";
import AccountCard from "./AccountCard";
import EmptyState from "./EmptyState";
import {
  getAccountStatusReason,
  getAccountInsight,
  getRemainingPercent,
  getRecommendedAccountId,
  isAccountInvalid,
} from "../utils/dashboard";
import { hoverLift, revealUp } from "../utils/motion";

interface AccountListProps {
  isRefreshing: boolean;
  refreshingAccountIds: string[];
  onDelete: (id: string) => void;
  onRefreshAccount: (id: string) => Promise<void>;
  onRename: (id: string, displayName: string) => Promise<void>;
  onSwitch: (account: Account) => void;
}

const AccountList: React.FC<AccountListProps> = ({
  isRefreshing,
  refreshingAccountIds,
  onDelete,
  onRefreshAccount,
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
  const featuredQuota = getRemainingPercent(featuredAccount?.rateLimits?.primary);
  const featuredIdentity =
    featuredAccount?.email ?? featuredAccount?.userId ?? "未识别身份";
  const featuredInsight = featuredAccount ? getAccountInsight(featuredAccount) : null;
  const featuredInvalid = featuredAccount ? isAccountInvalid(featuredAccount) : false;
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

  return (
    <section className="mx-auto w-full max-w-[1320px] space-y-2.5">
      {featuredAccount && (
        <div className="grid items-stretch gap-2.5 xl:grid-cols-[minmax(0,1fr)_240px]">
          <motion.article
            className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(145deg,#13181f_0%,#1c252f_54%,#2a3642_100%)] px-4 py-4 text-white shadow-[0_24px_58px_-46px_rgba(15,23,42,0.82)]"
            {...revealUp(prefersReducedMotion, 0.04)}
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-0 h-20 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_70%)]" />
            </div>

            <div className="relative grid gap-3 lg:grid-cols-[minmax(230px,1.1fr)_180px_minmax(230px,0.9fr)_180px] lg:items-center">
              <div className="flex min-w-0 flex-col justify-center">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-400">
                    Current
                  </span>
                  <span className="rounded-full border border-white/12 bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-white/86">
                    {featuredStatus}
                  </span>
                </div>
                <h2 className="mt-1 truncate text-[1.35rem] font-black tracking-[-0.05em] text-white">
                  {featuredAccount.displayName}
                </h2>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-slate-300">
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/8 px-2 py-0.5 text-[10px] font-medium text-white/86">
                    {featuredInsight?.roleLabel ?? "账号"}
                  </span>
                  <span className="truncate">{featuredIdentity}</span>
                </div>
                <button
                  onClick={() => onDelete(featuredAccount.id)}
                  className="mt-3 w-fit rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[11px] font-semibold text-white/50 transition-all hover:border-rose-200/35 hover:bg-rose-500/10 hover:text-rose-50"
                >
                  删除账号
                </button>
              </div>

              <div className="min-h-[74px] rounded-[18px] border border-white/10 bg-white/[0.045] px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  5h 剩余
                </p>
                <div className="mt-1 flex items-end gap-2">
                  <p className="text-[2.1rem] font-black leading-none tracking-[-0.1em] text-white">
                    {typeof featuredQuota === "number" ? `${Math.round(featuredQuota)}%` : "--"}
                  </p>
                  <span className="pb-0.5 text-xs font-semibold text-slate-300">
                    {featuredInsight?.hourlyQuota.resetLabel
                      ? `重置 ${featuredInsight.hourlyQuota.resetLabel}`
                      : ""}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="min-h-[62px] rounded-[16px] border border-white/10 bg-white/[0.055] px-3 py-2.5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    本周
                  </p>
                  <p className="mt-0.5 whitespace-nowrap text-xs font-bold text-white">
                    {featuredInsight?.weeklyQuota.valueLabel ?? "--"}
                  </p>
                </div>
                <div className="min-h-[62px] rounded-[16px] border border-white/10 bg-white/[0.055] px-3 py-2.5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    更新
                  </p>
                  <p className="mt-0.5 truncate text-xs font-bold text-white">
                    {featuredInsight?.syncLabel ?? "--"}
                  </p>
                </div>
              </div>

              <div className="flex flex-col justify-center gap-2">
                <button
                  onClick={() => void onRefreshAccount(featuredAccount.id)}
                  disabled={refreshingAccountIds.includes(featuredAccount.id) || isRefreshing}
                  className="rounded-full bg-white px-4 py-2.5 text-sm font-black text-slate-950 shadow-[0_18px_34px_-24px_rgba(255,255,255,0.82)] transition-all hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-white/55 disabled:text-slate-500 disabled:shadow-none"
                >
                  {refreshingAccountIds.includes(featuredAccount.id) || isRefreshing
                    ? "刷新中"
                    : "刷新当前"}
                </button>
                {!featuredAccount.isActive && (
                  <button
                    onClick={() =>
                      !featuredInvalid &&
                      !isSwitching &&
                      onSwitch(featuredAccount)
                    }
                    disabled={featuredInvalid || isSwitching}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed ${
                      featuredInvalid
                        ? "border border-rose-200 bg-rose-50 text-rose-600"
                        : "bg-white text-slate-950 shadow-[0_18px_32px_-24px_rgba(255,255,255,0.78)] disabled:bg-white/60"
                    }`}
                  >
                    {featuredInvalid
                      ? "账号失效"
                      : isSwitchTarget
                        ? "切换中..."
                        : "切换到此账号"}
                  </button>
                )}
              </div>

              {featuredInvalid && (
                <div className="rounded-[16px] border border-rose-200/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-50 lg:col-span-4">
                  {getAccountStatusReason(featuredAccount) ?? "请重新登录该账号"}
                </div>
              )}
            </div>
          </motion.article>

          <motion.aside
            className="apple-panel-muted flex h-full flex-col rounded-[22px] p-3"
            {...revealUp(prefersReducedMotion, 0.08)}
            whileHover={hoverLift(prefersReducedMotion)}
          >
            <p className="section-kicker">Next</p>
            <p className="mt-1 truncate text-[1.15rem] font-black tracking-[-0.05em] text-slate-950">
              {recommendedStandby?.displayName ?? "继续当前账号"}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              {recommendedStandby ? "需要切换时优先交给它" : "当前账号仍然最合适"}
            </p>

            <div className="apple-divider my-2.5 border-t" />

            <div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  5h 剩余
                </p>
                <p className="mt-0.5 text-sm font-bold tracking-[-0.04em] text-slate-950">
                  {typeof featuredQuota === "number" ? `${Math.round(featuredQuota)}%` : "--"}
                </p>
                <p className="mt-0.5 text-xs font-medium text-slate-500">
                  {featuredInsight?.hourlyQuota.resetLabel
                    ? `重置 ${featuredInsight.hourlyQuota.resetLabel}`
                    : "--"}
                </p>
              </div>
            </div>

            <button
              onClick={() => setAddModalOpen(true)}
              className="primary-action mt-auto w-full rounded-full px-3 py-1.5 text-xs font-semibold text-white"
            >
              添加账户
            </button>
          </motion.aside>
        </div>
      )}

      <motion.section
        className="apple-panel-muted rounded-[26px] p-3.5 sm:p-4"
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
