import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, motion, useReducedMotion } from "motion/react";
import { v4 as uuidv4 } from "uuid";
import Header from "./components/Header";
import AccountList from "./components/AccountList";
import UsageStatsPage from "./components/UsageStatsPage";
import TrayPanel from "./components/TrayPanel";
import SwitchProgress from "./components/SwitchProgress";
import AddAccountModal from "./components/AddAccountModal";
import SettingsModal from "./components/SettingsModal";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import { useAccountStore } from "./store/accountStore";
import { api } from "./utils/invoke";
import { hydrateAccounts, resolveCurrentAuthState } from "./utils/accounts";
import { importBackupBundle } from "./utils/backup";
import {
  findAccountForAuth,
  formatAuthIdentityLabel,
  parseAuthIdentity,
} from "./utils/auth";
import { getAccountStatusReason, getBestQuotaAccount, isAccountInvalid } from "./utils/dashboard";
import { useAccountSwitch } from "./hooks/useAccountSwitch";
import { Account } from "./types";
import { MOTION_EASE, revealUp } from "./utils/motion";

type ConfirmState =
  | { kind: "delete"; accountId: string }
  | { kind: "switch"; account: Account }
  | null;

const App: React.FC = () => {
  const {
    setAccounts,
    updateAccount,
    isAddModalOpen,
    isSettingsOpen,
    accounts,
    setSettings,
    setPlatformCapabilities,
    setSettingsSaveState,
    showToast,
    settings,
    platformCapabilities,
  } = useAccountStore();
  const { switchAccount } = useAccountSwitch();
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [currentView, setCurrentView] = useState<"accounts" | "stats">("accounts");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshingAccountIds, setRefreshingAccountIds] = useState<string[]>([]);
  const [isImportingCurrentAuth, setIsImportingCurrentAuth] = useState(false);
  const [isSmartSwitching, setIsSmartSwitching] = useState(false);
  const [isPreheating, setIsPreheating] = useState(false);
  const [unmanagedCurrentAuthLabel, setUnmanagedCurrentAuthLabel] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion() ?? false;
  const refreshingRef = useRef(false);
  const preheatingRef = useRef(false);
  const settingsLoadedRef = useRef(false);
  const lastSavedSettingsRef = useRef<string | null>(null);
  const isTrayMode =
    typeof window !== "undefined" &&
    (new URLSearchParams(window.location.search).get("tray") === "1" ||
      window.location.hash === "#tray");

  const executeSwitch = async (account: Account) => {
    await switchAccount(account);
  };

  const requestSwitch = async (account: Account) => {
    if (account.isActive) {
      return;
    }

    const canAutoRestartCodex =
      settings.autoRestartCodexAfterSwitch &&
      platformCapabilities?.supportsAutoRestartCodexDesktop === true;

    if (canAutoRestartCodex) {
      setConfirmState({ kind: "switch", account });
      return;
    }

    await executeSwitch(account);
  };

  const persistAccounts = async (nextAccounts: Account[]) => {
    setAccounts(nextAccounts);
    await api.saveAccounts({ version: "1.0", accounts: nextAccounts });
  };

  const refreshAccounts = async (silent = false) => {
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    setIsRefreshing(true);
    try {
      const store = await api.loadAccounts();
      const hydrated = await hydrateAccounts(store.accounts);
      setAccounts(hydrated);
      const invalidAccounts = hydrated.filter((account) => isAccountInvalid(account));
      const rateLimitFailures = hydrated.filter(
        (account) => !isAccountInvalid(account) && !account.rateLimits && account.rateLimitsError,
      );
      const activeChanged = hydrated.some(
        (account, index) => account.isActive !== store.accounts[index]?.isActive,
      );
      if (activeChanged) {
        await api.saveAccounts({ version: store.version, accounts: hydrated });
      }
      if (!silent) {
        if (invalidAccounts.length === hydrated.length && hydrated.length > 0) {
          showToast(`检测到 ${invalidAccounts.length} 个失效账号`);
        } else if (rateLimitFailures.length > 0 && invalidAccounts.length > 0) {
          showToast(
            `部分刷新失败 · ${rateLimitFailures[0].rateLimitsError}；检测到 ${invalidAccounts.length} 个失效账号`,
          );
        } else if (rateLimitFailures.length > 0) {
          showToast(`部分刷新失败 · ${rateLimitFailures[0].rateLimitsError}`);
        } else if (invalidAccounts.length > 0) {
          showToast(`已刷新，检测到 ${invalidAccounts.length} 个失效账号`);
        } else {
          showToast("已刷新");
        }
      }
    } catch (error) {
        if (!silent) {
          showToast(
            `刷新失败 · ${error instanceof Error ? error.message : String(error)}`,
          );
        }
    } finally {
      refreshingRef.current = false;
      setIsRefreshing(false);
    }
  };

  const refreshAccount = async (accountId: string) => {
    if (refreshingRef.current || refreshingAccountIds.includes(accountId)) {
      return;
    }

    const target = accounts.find((account) => account.id === accountId);
    if (!target) {
      return;
    }

    setRefreshingAccountIds((current) => [...current, accountId]);
    try {
      const [hydrated] = await hydrateAccounts([target]);
      if (!hydrated) {
        throw new Error("未获取到账号数据");
      }

      updateAccount(accountId, hydrated);

      if (isAccountInvalid(hydrated)) {
        showToast(
          `${hydrated.displayName} 已标记为失效 · ${getAccountStatusReason(hydrated) ?? "登录态或账号不可用"}`,
        );
      } else if (!hydrated.rateLimits && hydrated.rateLimitsError) {
        showToast(`刷新失败 · ${hydrated.rateLimitsError}`);
      } else {
        showToast(`${hydrated.displayName} 已刷新`);
      }
    } catch (error) {
      showToast(`刷新失败 · ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRefreshingAccountIds((current) => current.filter((id) => id !== accountId));
    }
  };

  const handleImportCurrentAuth = async () => {
    if (isImportingCurrentAuth) {
      return;
    }

    setIsImportingCurrentAuth(true);
    try {
      const currentAuth = await api.readAuthJson();
      const identity = parseAuthIdentity(currentAuth);
      if (!identity.email && !identity.userId && !identity.accountId) {
        throw new Error("当前 auth.json 中未识别到可导入的账号身份");
      }

      const existingAccount = await findAccountForAuth(accounts, currentAuth);
      let nextAccounts: Account[];

      if (existingAccount) {
        await api.saveAccountCredentials(existingAccount.id, currentAuth);
        nextAccounts = accounts.map((account) =>
          account.id === existingAccount.id
            ? {
                ...account,
                email: identity.email ?? account.email,
                userId: identity.userId ?? account.userId,
              }
            : account,
        );
      } else {
        const importedAccount: Account = {
          id: uuidv4(),
          displayName:
            identity.email?.split("@")[0] ??
            identity.userId ??
            `导入账户 ${accounts.length + 1}`,
          email: identity.email,
          userId: identity.userId,
          isActive: false,
          createdAt: new Date().toISOString(),
          lastSwitchedAt: null,
          sessionInfo: null,
        };

        await api.saveAccountCredentials(importedAccount.id, currentAuth);
        nextAccounts = [...accounts, importedAccount];
      }

      const hydrated = await hydrateAccounts(nextAccounts);
      await persistAccounts(hydrated);
      showToast(existingAccount ? "已更新当前授权" : "已导入当前授权");
    } catch (error) {
      showToast(`导入失败 · ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsImportingCurrentAuth(false);
    }
  };

  const handleSmartSwitch = async () => {
    if (isSmartSwitching) {
      return;
    }

    setIsSmartSwitching(true);
    try {
      const hydrated = await hydrateAccounts(accounts);
      await persistAccounts(hydrated);
      const invalidCount = hydrated.filter((account) => isAccountInvalid(account)).length;

      const bestAccount = getBestQuotaAccount(hydrated);
      if (!bestAccount) {
        throw new Error(
          invalidCount > 0
            ? `当前没有可用账号，已检测到 ${invalidCount} 个失效账号`
            : "当前没有足够数据",
        );
      }
      if (bestAccount.isActive) {
        showToast(`${bestAccount.displayName} 已是当前最佳选择`);
        return;
      }

      await requestSwitch(bestAccount);
    } catch (error) {
      showToast(`智能切换失败 · ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSmartSwitching(false);
    }
  };

  const runPreheatAccounts = async (silent = false) => {
    if (preheatingRef.current) {
      return false;
    }

    const latestSwitchPhase = useAccountStore.getState().switchState.phase;
    if (refreshingRef.current || latestSwitchPhase !== "idle") {
      return false;
    }

    preheatingRef.current = true;
    setIsPreheating(true);
    try {
      const response = await api.preheatAccounts();
      const resultMap = new Map(response.results.map((item) => [item.accountId, item]));
      const currentAccounts = useAccountStore.getState().accounts;
      const nextAccounts = currentAccounts.map((account) => {
        const result = resultMap.get(account.id);
        if (!result) {
          return account;
        }

        const rateLimitResult = result.rateLimitResult;
        return {
          ...account,
          lastPreheatAt: result.checkedAt,
          preheatStatus: result.outcome,
          preheatMessage: result.message,
          rateLimits: rateLimitResult?.rateLimits ?? account.rateLimits ?? null,
          rateLimitsError:
            rateLimitResult?.accountStatus === "invalid"
              ? rateLimitResult.accountStatusReason ?? "账号已失效或不可用"
              : null,
          accountStatus:
            rateLimitResult?.accountStatus ??
            (rateLimitResult?.rateLimits ? "available" : account.accountStatus ?? "unknown"),
          accountStatusReason: rateLimitResult?.accountStatusReason ?? null,
        };
      });

      await persistAccounts(nextAccounts);

      if (!silent) {
        if (response.successCount === 0 && response.errorCount === 0 && response.skippedCount > 0) {
          showToast("预热检查完成 · 当前账号本周窗口都已启动，暂时无需预热");
        } else {
          const parts = [
            response.successCount > 0 ? `已启动 ${response.successCount}` : null,
            response.skippedCount > 0 ? `无需预热 ${response.skippedCount}` : null,
            response.errorCount > 0 ? `失败 ${response.errorCount}` : null,
          ].filter((item): item is string => Boolean(item));

          showToast(parts.length > 0 ? `预热完成 · ${parts.join("，")}` : "预热完成");
        }
      }

      return true;
    } catch (error) {
      showToast(
        `${silent ? "自动预热失败" : "预热失败"} · ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    } finally {
      preheatingRef.current = false;
      setIsPreheating(false);
    }
  };

  const handlePreheatAccounts = async () => {
    await runPreheatAccounts(false);
  };

  useEffect(() => {
    void api.getPlatformCapabilities().then(setPlatformCapabilities).catch(() => undefined);
    api.loadSettings()
      .then((loadedSettings) => {
        setSettings(loadedSettings);
        lastSavedSettingsRef.current = JSON.stringify(loadedSettings);
      })
      .finally(() => {
        settingsLoadedRef.current = true;
      });
    void refreshAccounts(true);
  }, [setPlatformCapabilities, setSettings]);

  useEffect(() => {
    let cancelled = false;

    const syncCurrentAuthState = async () => {
      const currentAuthState = await resolveCurrentAuthState(accounts);
      if (cancelled) {
        return;
      }

      setUnmanagedCurrentAuthLabel(
        formatAuthIdentityLabel(currentAuthState.unmanagedIdentity),
      );
    };

    void syncCurrentAuthState();

    return () => {
      cancelled = true;
    };
  }, [accounts]);

  useEffect(() => {
    document.body.classList.toggle("tray-mode", isTrayMode);
    return () => document.body.classList.remove("tray-mode");
  }, [isTrayMode]);

  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldUseDark = settings.theme === "dark" || (settings.theme === "system" && prefersDark);

    root.classList.toggle("dark", shouldUseDark);
    root.style.colorScheme = shouldUseDark ? "dark" : "light";
  }, [settings.theme]);

  useEffect(() => {
    if (settings.autoRefreshInterval <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refreshAccounts(true);
    }, settings.autoRefreshInterval * 60 * 1000);

    return () => window.clearInterval(timer);
  }, [settings.autoRefreshInterval]);

  useEffect(() => {
    if (isTrayMode || settings.autoPreheatIntervalHours <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void runPreheatAccounts(true);
    }, settings.autoPreheatIntervalHours * 60 * 60 * 1000);

    return () => window.clearInterval(timer);
  }, [isTrayMode, settings.autoPreheatIntervalHours]);

  useEffect(() => {
    if (!settingsLoadedRef.current) {
      return;
    }

    const serialized = JSON.stringify(settings);
    if (serialized === lastSavedSettingsRef.current) {
      return;
    }

    setSettingsSaveState("saving");
    const timer = window.setTimeout(() => {
      api.saveSettings(settings)
        .then(() => {
          lastSavedSettingsRef.current = serialized;
          setSettingsSaveState("saved");
          window.setTimeout(() => setSettingsSaveState("idle"), 1200);
        })
        .catch((error) => {
          setSettingsSaveState("error");
          showToast(`保存失败 · ${error instanceof Error ? error.message : String(error)}`);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [settings, setSettingsSaveState, showToast]);

  const handleDelete = async () => {
    if (confirmState?.kind !== "delete") return;
    const deleteId = confirmState.accountId;
    try {
      await api.deleteAccountCredentials(deleteId);
      await api.deleteAccountSessions(deleteId);
      const next = accounts.filter((a) => a.id !== deleteId);
      setAccounts(next);
      await api.saveAccounts({ version: "1.0", accounts: next });
      showToast("已删除");
    } catch (err: unknown) {
      showToast(`删除失败 · ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConfirmState(null);
    }
  };

  const handleConfirmSwitch = async () => {
    if (confirmState?.kind !== "switch") {
      return;
    }

    const targetAccount = confirmState.account;
    setConfirmState(null);
    await executeSwitch(targetAccount);
  };

  const handleImportConfig = async (file: File) => {
    try {
      const imported = await importBackupBundle(file, accounts);
      setSettings(imported.settings);
      setAccounts(imported.accounts);
      showToast("已导入配置");
    } catch (error) {
      showToast(`导入失败 · ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleRename = async (id: string, displayName: string) => {
    const name = displayName.trim();
    if (!name) {
      showToast("请输入名称");
      return;
    }

    const next = accounts.map((account) =>
      account.id === id ? { ...account, displayName: name } : account,
    );

    try {
      setAccounts(next);
      await api.saveAccounts({ version: "1.0", accounts: next });
      showToast("名称已更新");
    } catch (error) {
      showToast(`保存失败 · ${error instanceof Error ? error.message : String(error)}`);
      await refreshAccounts(true);
    }
  };

  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig transition={{ duration: 0.72, ease: MOTION_EASE }}>
        <div
          className={
            isTrayMode
              ? "h-screen overflow-hidden bg-transparent text-stone-100"
              : "relative min-h-screen overflow-hidden text-slate-900"
          }
        >
          {!isTrayMode && (
            <>
              <motion.div
                aria-hidden
                className="pointer-events-none fixed inset-x-0 top-0 -z-20 h-[460px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.96),transparent_60%)]"
                {...revealUp(prefersReducedMotion, 0)}
              />
              <div className="pointer-events-none fixed inset-0 -z-30 bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(240,244,248,0.62)_40%,rgba(235,240,246,0.88))]" />
              <div className="pointer-events-none fixed inset-0 -z-20 shell-grid opacity-[0.18]" />
              <motion.div
                aria-hidden
                className="pointer-events-none fixed left-[-10rem] top-[6rem] -z-10 h-72 w-72 rounded-full bg-sky-100/28 blur-3xl"
                animate={
                  prefersReducedMotion
                    ? { opacity: 0.8 }
                    : { opacity: [0.55, 0.9, 0.55], y: [0, -18, 0] }
                }
                transition={
                  prefersReducedMotion
                    ? { duration: 0.2 }
                    : { duration: 16, repeat: Infinity, ease: "easeInOut" }
                }
              />
              <motion.div
                aria-hidden
                className="pointer-events-none fixed right-[-8rem] top-[10rem] -z-10 h-80 w-80 rounded-full bg-cyan-50/32 blur-3xl"
                animate={
                  prefersReducedMotion
                    ? { opacity: 0.75 }
                    : { opacity: [0.5, 0.82, 0.5], y: [0, 14, 0] }
                }
                transition={
                  prefersReducedMotion
                    ? { duration: 0.2 }
                    : { duration: 18, repeat: Infinity, ease: "easeInOut" }
                }
              />
            </>
          )}
          {!isTrayMode && (
            <Header
              onImportConfig={handleImportConfig}
              onImportCurrentAuth={handleImportCurrentAuth}
              onSmartSwitch={handleSmartSwitch}
              currentView={currentView}
              onViewChange={setCurrentView}
              isImportingCurrentAuth={isImportingCurrentAuth}
              isSmartSwitching={isSmartSwitching}
              unmanagedCurrentAuthLabel={unmanagedCurrentAuthLabel}
            />
          )}
          <main
            className={
              isTrayMode
                ? "h-full"
                : "relative z-10 mx-auto w-full max-w-[1520px] overflow-auto px-4 pb-10 pt-1 sm:px-6 sm:pt-2 lg:px-8 lg:pb-14"
            }
          >
            {isTrayMode ? (
              <TrayPanel
                unmanagedCurrentAuthLabel={unmanagedCurrentAuthLabel}
              />
            ) : (
              <AnimatePresence mode="wait">
                <motion.section
                  key={currentView}
                  {...revealUp(prefersReducedMotion, 0.04)}
                >
                  {currentView === "accounts" ? (
                    <AccountList
                      isPreheating={isPreheating}
                      isRefreshing={isRefreshing}
                      refreshingAccountIds={refreshingAccountIds}
                      onDelete={(id) => setConfirmState({ kind: "delete", accountId: id })}
                      onPreheatAccounts={() => handlePreheatAccounts()}
                      onRefreshAccount={refreshAccount}
                      onRefreshUsage={() => refreshAccounts(false)}
                      onRename={handleRename}
                      onSwitch={(account) => void requestSwitch(account)}
                    />
                  ) : (
                    <UsageStatsPage
                      isRefreshing={isRefreshing}
                      onRefreshUsage={() => refreshAccounts(false)}
                    />
                  )}
                </motion.section>
              </AnimatePresence>
            )}
          </main>
          <SwitchProgress />
          {isAddModalOpen && <AddAccountModal />}
          {isSettingsOpen && <SettingsModal />}
          <Toast />
          {confirmState?.kind === "delete" && (
        <ConfirmDialog
          title="删除账户"
          message="删除后会移除已保存的凭证和兼容会话目录。"
          confirmLabel="删除"
          onConfirm={handleDelete}
          onCancel={() => setConfirmState(null)}
        />
          )}
          {confirmState?.kind === "switch" && (
        <ConfirmDialog
          title="切换账户"
          message={`切换到 ${confirmState.account.displayName} 后，Codex 会重新打开。当前桌面会话会中断。`}
          confirmLabel="继续"
          tone="primary"
          onConfirm={() => void handleConfirmSwitch()}
          onCancel={() => setConfirmState(null)}
            />
          )}
        </div>
      </MotionConfig>
    </LazyMotion>
  );
};

export default App;
