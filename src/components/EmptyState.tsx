import React from "react";

interface EmptyStateProps {
  onAdd: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ onAdd }) => (
  <div className="mx-auto flex max-w-2xl flex-col items-center justify-center rounded-[32px] border border-dashed border-indigo-200 bg-white/70 px-8 py-24 text-center shadow-[0_28px_90px_-55px_rgba(79,70,229,0.55)]">
    <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-indigo-50">
      <svg
        className="h-12 w-12 text-indigo-300"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    </div>
    <h3 className="mb-3 text-3xl font-black tracking-[-0.04em] text-slate-950">
      还没有接入账户
    </h3>
    <p className="mb-8 max-w-md text-sm leading-7 text-slate-500">
      添加第一个 OAuth 账户后，这里会展示账户配额、共享会话信息和切换状态。
    </p>
    <button
      onClick={onAdd}
      className="rounded-2xl bg-[linear-gradient(160deg,_#6452ff_0%,_#4f46e5_100%)] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_35px_-20px_rgba(79,70,229,0.95)] transition-all hover:-translate-y-0.5"
    >
      添加账户
    </button>
  </div>
);

export default EmptyState;
