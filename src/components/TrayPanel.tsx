import React from "react";
import { clsx } from "clsx";
import { useAccountStore } from "../store/accountStore";
import { Account } from "../types";
import { formatRelativeTime, getAccountInsight, getRecommendedAccountId } from "../utils/dashboard";

interface TrayPanelProps {
  isRefreshing: boolean;
  refreshingAccountIds: string[];
  isImportingCurrentAuth: boolean;
  isSmartSwitching: boolean;
  unmanagedCurrentAuthLabel: string | null;
  onRefreshUsage: () => Promise<void>;
  onRefreshAccount: (id: string) => Promise<void>;
  onImportCurrentAuth: () => Promise<void>;
  onSmartSwitch: () => Promise<void>;
  onSwitch: (account: Account) => void;
}

const TrayPanel: React.FC<TrayPanelProps> = ({
  isRefreshing,
  refreshingAccountIds,
  isImportingCurrentAuth,
  isSmartSwitching,
  unmanagedCurrentAuthLabel,
  onRefreshUsage,
  onRefreshAccount,
  onImportCurrentAuth,
  onSmartSwitch,
  onSwitch,
}) => {
  const { accounts, setAddModalOpen, switchState } = useAccountStore();
  const recommendedId = getRecommendedAccountId(accounts);
  const isSwitching = switchState.phase !== "idle";
  const importButtonLabel = isImportingCurrentAuth
    ? "导入中..."
    : unmanagedCurrentAuthLabel
      ? "一键导入当前账号"
      : "导入当前授权";

  return (
    <section className="mx-auto w-full max-w-[520px] bg-transparent text-stone-100">
      <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(107,169,119,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(120,84,50,0.22),transparent_32%),linear-gradient(180deg,rgba(24,30,30,0.66),rgba(28,25,24,0.58))] px-4 pb-4 pt-3 shadow-[0_28px_90px_-36px_rgba(0,0,0,0.82)] backdrop-blur-[24px]">
        <div className="pointer-events-none absolute inset-0 opacity-60">
          <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.2),transparent_68%)]" />
          <div className="absolute -right-10 top-8 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="absolute -left-12 bottom-8 h-36 w-36 rounded-full bg-amber-300/10 blur-3xl" />
        </div>

        <div className="relative flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-cyan-200/80">
              Quick Deck
            </p>
            <h2 className="mt-1 text-[1.3rem] font-black tracking-[-0.05em] text-white/96">
              多账户切换
            </h2>
          </div>
          <button
            onClick={() => void onRefreshUsage()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/78 transition-all hover:border-white/25 hover:bg-white/14 hover:text-white disabled:opacity-60"
          >
            <svg
              className={clsx("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            刷新
          </button>
        </div>

        {unmanagedCurrentAuthLabel && (
          <div className="relative mt-3 rounded-[22px] border border-amber-200/20 bg-amber-300/10 px-3.5 py-3 text-amber-50 shadow-[0_22px_50px_-36px_rgba(245,158,11,0.7)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-100/76">
              Unmanaged
            </p>
            <p className="mt-1 text-sm font-semibold">
              当前 auth 属于未托管账号：{unmanagedCurrentAuthLabel}
            </p>
            <p className="mt-1 text-[12px] leading-5 text-amber-50/78">
              点击下方按钮可以一键导入，把当前授权纳入管理列表。
            </p>
          </div>
        )}

        <div className="relative mt-3 grid grid-cols-2 gap-2.5">
          <button
            onClick={() => void onImportCurrentAuth()}
            disabled={isImportingCurrentAuth}
            className="rounded-2xl border border-cyan-200/12 bg-cyan-300/10 px-3 py-3 text-sm font-semibold text-cyan-50 transition-all hover:border-cyan-200/24 hover:bg-cyan-300/14 disabled:opacity-60"
          >
            {importButtonLabel}
          </button>
          <button
            onClick={() => void onSmartSwitch()}
            disabled={isSmartSwitching}
            className="rounded-2xl border border-emerald-200/12 bg-emerald-300/10 px-3 py-3 text-sm font-semibold text-emerald-50 transition-all hover:border-emerald-200/24 hover:bg-emerald-300/14 disabled:opacity-60"
          >
            {isSmartSwitching ? "智能切换中..." : "智能切换"}
          </button>
          <button
            onClick={() => setAddModalOpen(true)}
            className="rounded-2xl border border-amber-200/12 bg-amber-300/10 px-3 py-3 text-sm font-semibold text-amber-50 transition-all hover:border-amber-200/24 hover:bg-amber-300/14"
          >
            添加账号
          </button>
          <div className="rounded-2xl border border-white/10 bg-white/8 px-3 py-3 text-sm text-white/66">
            账户数 <span className="font-semibold text-white/92">{accounts.length}</span>
          </div>
        </div>

        <div className="relative mt-4 grid grid-cols-2 gap-3.5">
          {accounts.length === 0 && (
            <div className="col-span-2 rounded-[24px] border border-dashed border-white/12 bg-white/8 px-4 py-8 text-center text-sm text-white/60">
              暂无账户，先导入当前授权或添加 OAuth 账户。
            </div>
          )}

          {accounts.map((account) => {
            const insight = getAccountInsight(account);
            const isActive = account.isActive;
            const isSelfRefreshing = refreshingAccountIds.includes(account.id);
            const shortAccountId = account.accountId ? account.accountId.slice(-8) : null;

            return (
              <article
                key={account.id}
                className={clsx(
                  "overflow-hidden rounded-[24px] border px-3 py-3 shadow-[0_24px_50px_-34px_rgba(0,0,0,0.7)] backdrop-blur-xl",
                  isActive
                    ? "border-cyan-300/30 bg-[linear-gradient(180deg,rgba(26,88,92,0.4),rgba(37,47,41,0.4))]"
                    : recommendedId === account.id
                      ? "border-amber-300/28 bg-[linear-gradient(180deg,rgba(102,74,39,0.44),rgba(53,44,30,0.46))]"
                      : "border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))]",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[13px] font-bold tracking-[-0.03em] text-white/95">
                        {account.displayName}
                      </h3>
                      {recommendedId === account.id && !isActive && (
                        <span className="rounded-full border border-amber-200/20 bg-amber-200/14 px-1.5 py-0.5 text-[9px] font-bold text-amber-50">
                          推荐
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-white/60">
                      {account.email ?? account.userId ?? "未绑定邮箱"}
                    </p>
                    {shortAccountId && (
                      <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">
                        Team {shortAccountId}
                      </p>
                    )}
                  </div>

                  <span
                    className={clsx(
                      "rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]",
                      isActive
                        ? "border-cyan-300/20 bg-cyan-300/12 text-cyan-100"
                        : "border-white/10 bg-white/10 text-white/72",
                    )}
                  >
                    {isActive ? "当前" : insight.roleLabel}
                  </span>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-2xl border border-white/7 bg-black/10 p-2.5">
                  {[insight.hourlyQuota, insight.weeklyQuota].map((metric) => (
                    <div key={metric.label}>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/38">
                        {metric.label.includes("5小时") ? "5H" : "WEEK"}
                      </div>
                      <div className="mt-1 text-[12px] font-bold text-white/92">{metric.valueLabel}</div>
                      <div className="mt-0.5 truncate text-[10px] leading-4 text-white/50" title={metric.detail}>
                        {metric.detail}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-white/42">
                  <span className="truncate">最近切换 {formatRelativeTime(account.lastSwitchedAt)}</span>
                  <button
                    onClick={() => void onRefreshAccount(account.id)}
                    disabled={isRefreshing || isSelfRefreshing}
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1 font-semibold text-white/72 transition-all hover:border-white/20 hover:bg-white/14 disabled:opacity-60"
                  >
                    <svg
                      className={clsx("h-3 w-3", (isRefreshing || isSelfRefreshing) && "animate-spin")}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    刷新
                  </button>
                </div>

                <button
                  onClick={() => !isActive && onSwitch(account)}
                  disabled={isActive || isSwitching}
                  className={clsx(
                    "mt-2.5 w-full rounded-2xl px-3 py-2 text-[12px] font-semibold transition-all disabled:cursor-not-allowed",
                    isActive
                      ? "border border-cyan-300/18 bg-cyan-300/12 text-cyan-100"
                      : "border border-white/12 bg-white/12 text-white hover:border-white/20 hover:bg-white/16",
                  )}
                >
                  {isActive ? "正在使用中" : isSwitching ? "切换中..." : "切换"}
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default TrayPanel;
