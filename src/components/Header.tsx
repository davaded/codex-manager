import React, { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useAccountStore } from "../store/accountStore";
import { exportBackupBundle } from "../utils/backup";
import { DISPLAY_TIME_ZONE_LABEL } from "../utils/dashboard";
import { hoverLift, revealUp } from "../utils/motion";
import packageJson from "../../package.json";

interface HeaderProps {
  onImportConfig: (file: File) => Promise<void>;
  onImportCurrentAuth: () => Promise<void>;
  onSmartSwitch: () => Promise<void>;
  currentView: "accounts" | "stats";
  onViewChange: (view: "accounts" | "stats") => void;
  isImportingCurrentAuth: boolean;
  isSmartSwitching: boolean;
  unmanagedCurrentAuthLabel: string | null;
}

const APP_VERSION = `v${packageJson.version}`;

const Header: React.FC<HeaderProps> = ({
  onImportConfig,
  onImportCurrentAuth,
  onSmartSwitch,
  currentView,
  onViewChange,
  isImportingCurrentAuth,
  isSmartSwitching,
  unmanagedCurrentAuthLabel,
}) => {
  const { accounts, settings, setSettingsOpen, setAddModalOpen, showToast } =
    useAccountStore();
  const prefersReducedMotion = useReducedMotion() ?? false;
  const activeAccount = accounts.find((account) => account.isActive);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const managedCount = accounts.length;

  const handleExport = async () => {
    try {
      await exportBackupBundle(accounts, settings);
      showToast("已导出备份");
    } catch (error) {
      showToast(`导出失败 · ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await onImportConfig(file);
    event.target.value = "";
  };

  const subtitle = activeAccount
    ? `当前承接：${activeAccount.displayName}`
    : unmanagedCurrentAuthLabel
      ? `发现未纳管授权：${unmanagedCurrentAuthLabel}`
      : "把当前授权、余量和切换放在一处。";

  const importButtonLabel = isImportingCurrentAuth
    ? "导入中"
    : unmanagedCurrentAuthLabel
      ? "导入当前授权"
      : "导入当前授权";

  const statusItems = [
    {
      label: "当前账号",
      value: activeAccount?.displayName ?? "未匹配当前授权",
    },
    {
      label: "账户数",
      value: `${managedCount} 个`,
    },
  ];

  return (
    <motion.header
      className="sticky top-0 z-20 px-4 pb-3 pt-3 sm:px-6 lg:px-8"
      {...revealUp(prefersReducedMotion, 0)}
    >
      <div className="toolbar-shell mx-auto w-full max-w-[1320px] rounded-[26px] px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3 xl:flex-row xl:items-center xl:gap-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[15px] bg-[linear-gradient(155deg,#151a22_0%,#273140_58%,#5c697a_100%)] text-white shadow-[0_18px_30px_-20px_rgba(22,26,31,0.62)]">
                <svg
                  className="h-4.5 w-4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l6 6-6 6" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 18h5" />
                </svg>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="truncate text-[1.28rem] font-black tracking-[-0.05em] text-slate-950 sm:text-[1.42rem]">
                    Codex Manager
                  </h1>
                  <span className="rounded-full border border-white/75 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                    {APP_VERSION}
                  </span>
                  <span className="rounded-full border border-slate-200/70 bg-slate-50/70 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                    时间 {DISPLAY_TIME_ZONE_LABEL}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[13px] text-slate-500">{subtitle}</p>
              </div>
            </div>

            <div className="hidden min-w-0 flex-wrap items-center gap-2.5 xl:flex">
              {statusItems.map((item) => (
                <motion.div
                  key={item.label}
                  layout
                  className="status-chip min-w-[132px] rounded-[20px] px-3.5 py-2.5"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    {item.label}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-900">{item.value}</p>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <div className="toolbar-pill inline-flex rounded-full p-1.5">
              {([
                {
                  key: "accounts",
                  label: "账户",
                },
                {
                  key: "stats",
                  label: "统计",
                },
              ] as const).map((item) => {
                const isActive = currentView === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => onViewChange(item.key)}
                    className={`relative rounded-full px-4 py-2 text-left text-sm font-semibold transition-all ${
                      isActive ? "text-slate-950" : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="view-pill"
                        className="absolute inset-0 rounded-full bg-white shadow-[0_20px_34px_-24px_rgba(15,23,42,0.24)]"
                        transition={{ type: "spring", stiffness: 280, damping: 28 }}
                      />
                    )}
                    <span className="relative z-10">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportChange}
            />

            <button
              onClick={() => void onSmartSwitch()}
              disabled={isSmartSwitching}
              className="primary-action rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isSmartSwitching ? "智能切换中..." : "智能切换"}
            </button>

            <motion.button
              onClick={() => setAddModalOpen(true)}
              className="glass-pill rounded-full px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-white/78"
              whileHover={hoverLift(prefersReducedMotion)}
            >
              添加账户
            </motion.button>

            <details className="menu-popover group relative">
              <summary className="glass-pill flex h-11 min-w-11 list-none items-center justify-center rounded-full px-3 text-slate-500 transition-all hover:bg-white/78 hover:text-slate-900">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
                </svg>
              </summary>
              <div className="apple-panel-strong absolute right-0 mt-3 w-56 rounded-[24px] p-2 shadow-[0_28px_54px_-36px_rgba(15,23,42,0.35)]">
                <button
                  onClick={() => void onImportCurrentAuth()}
                  disabled={isImportingCurrentAuth}
                  className="flex w-full rounded-[18px] px-4 py-3 text-left text-sm font-medium text-slate-600 transition-all hover:bg-white/80 hover:text-slate-950 disabled:opacity-60"
                >
                  {importButtonLabel}
                </button>
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="flex w-full rounded-[18px] px-4 py-3 text-left text-sm font-medium text-slate-600 transition-all hover:bg-white/80 hover:text-slate-950"
                >
                  导入配置
                </button>
                <button
                  onClick={handleExport}
                  className="flex w-full rounded-[18px] px-4 py-3 text-left text-sm font-medium text-slate-600 transition-all hover:bg-white/80 hover:text-slate-950"
                >
                  导出备份
                </button>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="flex w-full rounded-[18px] px-4 py-3 text-left text-sm font-medium text-slate-600 transition-all hover:bg-white/80 hover:text-slate-950"
                >
                  设置
                </button>
              </div>
            </details>
          </div>
        </div>

        <AnimatePresence>
          {unmanagedCurrentAuthLabel && (
            <motion.div
              className="apple-divider relative mt-4 border-t pt-4"
              {...revealUp(prefersReducedMotion, 0.02)}
            >
              <div className="flex flex-col gap-3 rounded-[22px] border border-amber-200/70 bg-[linear-gradient(135deg,rgba(255,248,236,0.92),rgba(255,252,245,0.98))] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="section-kicker text-amber-700">Current Auth</p>
                  <p className="mt-2 text-sm text-amber-900/75">
                  当前 auth.json 属于 {unmanagedCurrentAuthLabel}，可以直接纳入这组账号。
                </p>
              </div>
                <button
                  onClick={() => void onImportCurrentAuth()}
                  disabled={isImportingCurrentAuth}
                  className="rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_32px_-26px_rgba(217,119,6,0.8)] transition-all hover:bg-amber-600 disabled:opacity-60"
                >
                  {importButtonLabel}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
};

export default Header;
