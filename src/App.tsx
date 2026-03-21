import React, { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import Header from "./components/Header";
import AccountList from "./components/AccountList";
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
import { getBestQuotaAccount } from "./utils/dashboard";
import { useAccountSwitch } from "./hooks/useAccountSwitch";
import { Account } from "./types";

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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshingAccountIds, setRefreshingAccountIds] = useState<string[]>([]);
  const [isImportingCurrentAuth, setIsImportingCurrentAuth] = useState(false);
  const [isSmartSwitching, setIsSmartSwitching] = useState(false);
  const [unmanagedCurrentAuthLabel, setUnmanagedCurrentAuthLabel] = useState<string | null>(null);
  const refreshingRef = useRef(false);
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
      const rateLimitFailures = hydrated.filter(
        (account) => !account.rateLimits && account.rateLimitsError,
      );
      const activeChanged = hydrated.some(
        (account, index) => account.isActive !== store.accounts[index]?.isActive,
      );
      if (activeChanged) {
        await api.saveAccounts({ version: store.version, accounts: hydrated });
      }
      if (!silent) {
        if (rateLimitFailures.length === hydrated.length && hydrated.length > 0) {
          showToast(`刷新失败: ${rateLimitFailures[0].rateLimitsError}`);
        } else if (rateLimitFailures.length > 0) {
          showToast(
            `部分账号刷新失败（${rateLimitFailures.length}/${hydrated.length}）: ${rateLimitFailures[0].rateLimitsError}`,
          );
        } else {
          showToast("用量已刷新");
        }
      }
    } catch (error) {
      if (!silent) {
        showToast(
          `刷新失败: ${error instanceof Error ? error.message : String(error)}`,
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

      if (!hydrated.rateLimits && hydrated.rateLimitsError) {
        showToast(`刷新失败: ${hydrated.rateLimitsError}`);
      } else {
        showToast(`${hydrated.displayName} 配额已刷新`);
      }
    } catch (error) {
      showToast(`刷新失败: ${error instanceof Error ? error.message : String(error)}`);
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
      showToast(existingAccount ? "当前授权已更新到现有账户" : "当前授权已导入");
    } catch (error) {
      showToast(`导入当前授权失败: ${error instanceof Error ? error.message : String(error)}`);
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

      const bestAccount = getBestQuotaAccount(hydrated);
      if (!bestAccount) {
        throw new Error("没有可用于智能切换的真实配额数据");
      }
      if (bestAccount.isActive) {
        showToast(`当前账号 ${bestAccount.displayName} 已是最佳选择`);
        return;
      }

      await requestSwitch(bestAccount);
    } catch (error) {
      showToast(`智能切换失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSmartSwitching(false);
    }
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
          showToast(`设置保存失败: ${error instanceof Error ? error.message : String(error)}`);
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
      showToast("账户已删除");
    } catch (err: unknown) {
      showToast(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
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
      showToast("配置已导入");
    } catch (error) {
      showToast(`导入失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleRename = async (id: string, displayName: string) => {
    const name = displayName.trim();
    if (!name) {
      showToast("名称不能为空");
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
      showToast(`名称保存失败: ${error instanceof Error ? error.message : String(error)}`);
      await refreshAccounts(true);
    }
  };

  return (
    <div
      className={
        isTrayMode
          ? "min-h-screen bg-transparent p-2 text-stone-100"
          : "min-h-screen flex flex-col bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.16),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.1),_transparent_22%),linear-gradient(180deg,_#f6f8ff_0%,_#ffffff_42%,_#f9fbff_100%)] text-slate-900"
      }
    >
      {!isTrayMode && (
        <Header
          onImportConfig={handleImportConfig}
          onImportCurrentAuth={handleImportCurrentAuth}
          onSmartSwitch={handleSmartSwitch}
          isImportingCurrentAuth={isImportingCurrentAuth}
          isSmartSwitching={isSmartSwitching}
          unmanagedCurrentAuthLabel={unmanagedCurrentAuthLabel}
        />
      )}
      <main className={isTrayMode ? "" : "flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-3 lg:px-8"}>
        {isTrayMode ? (
          <TrayPanel
            isRefreshing={isRefreshing}
            refreshingAccountIds={refreshingAccountIds}
            isImportingCurrentAuth={isImportingCurrentAuth}
            isSmartSwitching={isSmartSwitching}
            unmanagedCurrentAuthLabel={unmanagedCurrentAuthLabel}
            onRefreshUsage={() => refreshAccounts(false)}
            onRefreshAccount={refreshAccount}
            onImportCurrentAuth={handleImportCurrentAuth}
            onSmartSwitch={handleSmartSwitch}
            onSwitch={(account) => void requestSwitch(account)}
          />
        ) : (
          <AccountList
            isRefreshing={isRefreshing}
            refreshingAccountIds={refreshingAccountIds}
            onDelete={(id) => setConfirmState({ kind: "delete", accountId: id })}
            onRefreshAccount={refreshAccount}
            onRefreshUsage={() => refreshAccounts(false)}
            onRename={handleRename}
            onSwitch={(account) => void requestSwitch(account)}
          />
        )}
      </main>
      <SwitchProgress />
      {isAddModalOpen && <AddAccountModal />}
      {isSettingsOpen && <SettingsModal />}
      <Toast />
      {confirmState?.kind === "delete" && (
        <ConfirmDialog
          title="删除账户"
          message="确定要删除此账户吗？其保存的凭证和兼容快照会被移除，但不会清空当前共享会话。"
          confirmLabel="确认删除"
          onConfirm={handleDelete}
          onCancel={() => setConfirmState(null)}
        />
      )}
      {confirmState?.kind === "switch" && (
        <ConfirmDialog
          title="确认切换账户"
          message={`切换到 ${confirmState.account.displayName} 后，会自动关闭并重新打开 Codex 桌面应用。当前正在运行的桌面端会话会被中断。`}
          confirmLabel="继续切换"
          tone="primary"
          onConfirm={() => void handleConfirmSwitch()}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
};

export default App;
