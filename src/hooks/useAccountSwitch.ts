import { useAccountStore } from "../store/accountStore";
import { api } from "../utils/invoke";
import { Account } from "../types";

export const useAccountSwitch = () => {
  const { setSwitchState, showToast, setAccounts } = useAccountStore();

  const switchAccount = async (toAccount: Account) => {
    const { accounts, settings, platformCapabilities } = useAccountStore.getState();
    const activeAccount = accounts.find((a) => a.isActive);
    const fromId = activeAccount?.id ?? null;
    const toId = toAccount.id;
    const canAutoRestartCodex =
      settings.autoRestartCodexAfterSwitch &&
      platformCapabilities?.supportsAutoRestartCodexDesktop === true;

    setSwitchState({
      phase: "snapshotting",
      fromAccountId: fromId,
      toAccountId: toId,
      error: null,
      snapshotResult: null,
      restoreResult: null,
    });

    let t1: ReturnType<typeof setTimeout> | undefined;
    let t2: ReturnType<typeof setTimeout> | undefined;

    try {
      const toAuth = await api.readAccountCredentials(toId);

      // Simulate visual phase transitions while backend runs atomically
      t1 = setTimeout(() => setSwitchState({ phase: "restoring" }), 600);
      t2 = setTimeout(() => setSwitchState({ phase: "writing_auth" }), 1400);

      const result = await api.switchAccount(fromId, toId, toAuth);

      clearTimeout(t1);
      clearTimeout(t2);

      if (!result.success) {
        throw new Error(result.error ?? "Switch failed for unknown reason");
      }

      setSwitchState({
        phase: "done",
        snapshotResult: result.snapshot,
        restoreResult: result.restore,
      });

      const now = new Date().toISOString();
      const currentSessionInfo = await api.getCurrentSessionsInfo().catch(() => null);
      const sharedSessionInfo = {
        fileCount: currentSessionInfo?.fileCount ?? result.restore.fileCount,
        totalBytes: currentSessionInfo?.totalBytes ?? result.restore.totalBytes,
        lastSnapshotAt:
          currentSessionInfo?.currentUpdatedAt ??
          currentSessionInfo?.lastSnapshotAt ??
          result.restore.restoreTime,
        currentSessionId: currentSessionInfo?.currentSessionId ?? null,
        currentThreadName: currentSessionInfo?.currentThreadName ?? null,
        currentUpdatedAt: currentSessionInfo?.currentUpdatedAt ?? null,
      };
      const updatedAccounts = accounts.map((a) => ({
        ...a,
        isActive: a.id === toId,
        lastSwitchedAt: a.id === toId ? now : a.lastSwitchedAt,
        sessionInfo:
          a.id === toId
            ? sharedSessionInfo
            : a.id === fromId
            ? {
                fileCount: result.snapshot.fileCount,
                totalBytes: result.snapshot.totalBytes,
                lastSnapshotAt: result.snapshot.snapshotTime,
                currentSessionId:
                  activeAccount?.sessionInfo?.currentSessionId ??
                  currentSessionInfo?.currentSessionId ??
                  null,
                currentThreadName:
                  activeAccount?.sessionInfo?.currentThreadName ??
                  currentSessionInfo?.currentThreadName ??
                  null,
                currentUpdatedAt:
                  activeAccount?.sessionInfo?.currentUpdatedAt ??
                  currentSessionInfo?.currentUpdatedAt ??
                  null,
              }
            : a.sessionInfo,
      }));

      setAccounts(updatedAccounts);
      let persistErrorMessage: string | null = null;
      try {
        await api.saveAccounts({ version: "1.0", accounts: updatedAccounts });
      } catch (persistError: unknown) {
        persistErrorMessage =
          persistError instanceof Error ? persistError.message : String(persistError);
      }

      let restartErrorMessage: string | null = null;
      if (canAutoRestartCodex) {
        try {
          await api.restartCodexDesktop();
        } catch (restartError: unknown) {
          restartErrorMessage =
            restartError instanceof Error ? restartError.message : String(restartError);
        }
      }

      const issues = [
        persistErrorMessage
          ? `本地状态保存失败: ${persistErrorMessage}`
          : null,
        restartErrorMessage
          ? `自动重启 Codex 失败，请手动重新打开 Codex: ${restartErrorMessage}`
          : null,
      ].filter((issue): issue is string => Boolean(issue));

      if (issues.length > 0) {
        showToast(`已切换至 ${toAccount.displayName}，但${issues.join("；")}`);
      } else if (canAutoRestartCodex) {
        showToast(`已切换至 ${toAccount.displayName}，正在重新打开 Codex`);
      } else {
        showToast(`已切换至 ${toAccount.displayName}，请重新打开 Codex 以使用新账号`);
      }

      setTimeout(
        () =>
          setSwitchState({ phase: "idle", fromAccountId: null, toAccountId: null }),
        1500,
      );
    } catch (err: unknown) {
      clearTimeout(t1);
      clearTimeout(t2);
      const msg = err instanceof Error ? err.message : String(err);
      setSwitchState({ phase: "error", error: msg });
      showToast(`切换失败: ${msg}`);
    }
  };

  return { switchAccount };
};
