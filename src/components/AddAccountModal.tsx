import React, { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAccountStore } from "../store/accountStore";
import { api } from "../utils/invoke";
import { Account } from "../types";
import { hydrateAccounts } from "../utils/accounts";

const AddAccountModal: React.FC = () => {
  const { setAddModalOpen, accounts, setAccounts, showToast } = useAccountStore();
  const [loading, setLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isOauthCancelledError = (message: string) =>
    /cancelled|canceled|取消/i.test(message);

  const handleCancel = async () => {
    if (loading) {
      try {
        await api.cancelOauthFlow();
      } catch {
        // The modal is closing anyway, so ignore cancellation transport errors here.
      }
    }

    if (isMountedRef.current) {
      setAddModalOpen(false);
    }
  };

  const handleAdd = async () => {
    if (!displayName.trim()) {
      showToast("请输入显示名称");
      return;
    }

    setLoading(true);
    try {
      const result = await api.startOauthFlow();

      const newAccount: Account = {
        id: uuidv4(),
        displayName: displayName.trim(),
        email: result.email,
        userId: result.userId,
        isActive: false,
        createdAt: new Date().toISOString(),
        lastSwitchedAt: null,
        sessionInfo: null,
      };

      await api.saveAccountCredentials(newAccount.id, result.authJson);
      const next = await hydrateAccounts([...accounts, newAccount]);
      setAccounts(next);
      await api.saveAccounts({ version: "1.0", accounts: next });

      showToast("账户添加成功");
      if (isMountedRef.current) {
        setAddModalOpen(false);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isOauthCancelledError(message)) {
        showToast(`添加失败: ${message}`);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-account-title"
    >
      <div className="w-full max-w-lg rounded-[28px] border border-white/70 bg-white p-8 shadow-[0_28px_80px_-35px_rgba(15,23,42,0.5)]">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-indigo-500/80">
            OAuth
          </p>
          <h2
            id="add-account-title"
            className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950"
          >
            添加账户
          </h2>
          <p className="mt-2 text-sm leading-7 text-slate-500">
            输入一个清晰的显示名称，然后启动授权流程。完成登录后，该账户会加入当前工作区。
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              显示名称
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="例如：工作账号（主）"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              autoFocus
            />
          </div>

          <p className="rounded-2xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-sm leading-6 text-indigo-700">
            点击“开始授权”后，浏览器会打开 OpenAI 登录页。认证完成后会自动回到应用。
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={handleCancel}
              className="rounded-2xl px-5 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
            >
              {loading ? "取消授权" : "取消"}
            </button>
            <button
              onClick={handleAdd}
              disabled={loading}
              className="flex items-center gap-2 rounded-2xl bg-[linear-gradient(160deg,_#6452ff_0%,_#4f46e5_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_35px_-20px_rgba(79,70,229,0.95)] transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {loading ? "授权中..." : "开始授权"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddAccountModal;
