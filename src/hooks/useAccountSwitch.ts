import { useAccountStore } from "../store/accountStore";
import { api } from "../utils/invoke";
import { Account } from "../types";
import { beginAccountUsage, finalizeAccountUsage } from "../utils/tokenLedger";

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
    const canAutoRestartVscode =
      settings.autoRestartVscodeAfterSwitch &&
      platformCapabilities?.supportsAutoRestartVscode === true;

    setSwitchState({
      phase: "preparing",
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
      const usageSummary = await api.readUsageStatsSummary().catch(() => null);
      const liveUsage = usageSummary?.latestTotalTokens ?? null;

      // Keep progress feedback aligned with the actual auth-switch flow.
      t1 = setTimeout(() => setSwitchState({ phase: "writing_auth" }), 400);
      t2 = setTimeout(() => setSwitchState({ phase: "syncing_state" }), 1000);

      const result = await api.switchAccount(fromId, toId, toAuth);

      clearTimeout(t1);
      clearTimeout(t2);

      if (!result.success) {
        throw new Error(result.error ?? "切换未完成");
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
        lastSessionObservedAt:
          currentSessionInfo?.currentUpdatedAt ??
          currentSessionInfo?.lastSessionObservedAt ??
          result.restore.restoreTime,
        currentSessionId: currentSessionInfo?.currentSessionId ?? null,
        currentThreadName: currentSessionInfo?.currentThreadName ?? null,
        currentUpdatedAt: currentSessionInfo?.currentUpdatedAt ?? null,
      };
      const updatedAccounts = accounts.map((a) => ({
        ...(a.id === fromId
          ? finalizeAccountUsage(a, liveUsage, now)
          : a.id === toId
            ? beginAccountUsage(a, liveUsage, now)
            : a),
        isActive: a.id === toId,
        lastSwitchedAt: a.id === toId ? now : a.lastSwitchedAt,
        sessionInfo:
          a.id === toId
            ? sharedSessionInfo
            : a.id === fromId
              ? {
                  fileCount: result.snapshot.fileCount,
                  totalBytes: result.snapshot.totalBytes,
                  lastSessionObservedAt: result.snapshot.snapshotTime,
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

      let vscodeRestartErrorMessage: string | null = null;
      if (canAutoRestartVscode) {
        try {
          await api.restartVscode();
        } catch (restartError: unknown) {
          vscodeRestartErrorMessage =
            restartError instanceof Error ? restartError.message : String(restartError);
        }
      }

      const issues = [
        persistErrorMessage
          ? `保存失败 · ${persistErrorMessage}`
          : null,
        restartErrorMessage
          ? `Codex 重启失败 · ${restartErrorMessage}`
          : null,
        vscodeRestartErrorMessage
          ? `VSCode 重启失败 · ${vscodeRestartErrorMessage}`
          : null,
      ].filter((issue): issue is string => Boolean(issue));
      const restartedTargets = [
        canAutoRestartCodex ? "Codex" : null,
        canAutoRestartVscode ? "VSCode" : null,
      ].filter((target): target is string => Boolean(target));

      if (issues.length > 0) {
        showToast(`已切换到 ${toAccount.displayName} · ${issues.join("；")}`);
      } else if (restartedTargets.length > 0) {
        showToast(`已切换到 ${toAccount.displayName} · 已重启 ${restartedTargets.join("、")}`);
      } else {
        showToast(`已切换到 ${toAccount.displayName} · 请重新打开 Codex/VSCode`);
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
      showToast(`切换失败 · ${msg}`);
    }
  };

  return { switchAccount };
};
