import React from "react";
import { useAccountStore } from "../store/accountStore";
import { Account } from "../types";
import AccountCard from "./AccountCard";
import EmptyState from "./EmptyState";
import { getRecommendedAccountId } from "../utils/dashboard";

interface AccountListProps {
  isRefreshing: boolean;
  refreshingAccountIds: string[];
  onDelete: (id: string) => void;
  onRefreshAccount: (id: string) => Promise<void>;
  onRefreshUsage: () => Promise<void>;
  onRename: (id: string, displayName: string) => Promise<void>;
  onSwitch: (account: Account) => void;
}

const AccountList: React.FC<AccountListProps> = ({
  isRefreshing,
  refreshingAccountIds,
  onDelete,
  onRefreshAccount,
  onRefreshUsage,
  onRename,
  onSwitch,
}) => {
  const { accounts, setAddModalOpen } = useAccountStore();

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

  return (
    <section className="mx-auto w-full max-w-[1480px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2.5">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-indigo-500/80">
            Workspace
          </p>
          <h2 className="mt-1.5 text-[1.85rem] font-black tracking-[-0.05em] text-slate-950 sm:text-[2rem]">
            账号管理
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            管理工作号、备用号与测试号，快速查看切换状态和配额压力。
          </p>
        </div>

        <button
          onClick={onRefreshUsage}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm font-medium text-slate-600 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.8)] transition-all hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg
            className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          刷新用量
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-10">
        {sorted.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            isRecommended={account.id === recommendedId}
            isRefreshing={isRefreshing}
            isRefreshingSelf={refreshingAccountIds.includes(account.id)}
            onDelete={onDelete}
            onRefresh={() => onRefreshAccount(account.id)}
            onRename={onRename}
            onSwitch={onSwitch}
          />
        ))}

        <button
          onClick={() => setAddModalOpen(true)}
          className="group flex min-h-[300px] w-full flex-col items-center justify-center rounded-[24px] border border-dashed border-indigo-200/70 bg-white/55 px-5 text-center shadow-[0_24px_65px_-50px_rgba(99,102,241,0.55)] transition-all hover:-translate-y-1 hover:border-indigo-300 hover:bg-white"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 transition-all group-hover:scale-105 group-hover:bg-indigo-100">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <h3 className="mt-4 text-lg font-bold tracking-[-0.03em] text-slate-900">
            添加新账户
          </h3>
          <p className="mt-2.5 max-w-xs text-sm leading-6 text-slate-500">
            通过 OAuth 登录接入新的 Codex 账户，纳入统一切换与会话管理。
          </p>
        </button>
      </div>
    </section>
  );
};

export default AccountList;
