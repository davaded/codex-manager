import React, { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAccountStore } from "../store/accountStore";
import { api } from "../utils/invoke";
import { Account } from "../types";
import { hydrateAccounts } from "../utils/accounts";

type OAuthErrorKind =
  | "flow_active"
  | "callback_port_in_use"
  | "open_browser_failed"
  | "proxy_config"
  | "client_build_failed"
  | "region_restricted"
  | "network_timeout"
  | "network_connect"
  | "network_error"
  | "browser_auth_error"
  | "state_mismatch"
  | "timeout"
  | "channel_closed"
  | "empty_code"
  | "token_exchange_failed"
  | "token_parse_failed"
  | "generic";

interface OAuthGuidance {
  kind: OAuthErrorKind;
  title: string;
  detail: string;
  steps: string[];
  canOpenProxySettings: boolean;
}

const AddAccountModal: React.FC = () => {
  const { setAddModalOpen, setSettingsOpen, accounts, setAccounts, showToast } = useAccountStore();
  const [loading, setLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [oauthGuidance, setOauthGuidance] = useState<OAuthGuidance | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void handleCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      isMountedRef.current = false;
    };
  }, []);

  const isOauthCancelledError = (message: string) =>
    /cancelled|canceled|取消/i.test(message);

  const parseOauthGuidance = (rawMessage: string): OAuthGuidance => {
    const match = rawMessage.match(/^\[oauth:([a-z_]+)\]\s*(.*)$/i);
    const kind = (match?.[1] ?? "generic") as OAuthErrorKind;
    const detail = (match?.[2] ?? rawMessage).trim();

    switch (kind) {
      case "flow_active":
        return {
          kind,
          title: "已有授权流程在进行",
          detail,
          steps: [
            "先完成当前浏览器授权，或者关闭后重新开始。",
            "如果页面已经不存在，重新打开添加账户即可。",
          ],
          canOpenProxySettings: false,
        };
      case "callback_port_in_use":
        return {
          kind,
          title: "本地回调端口被占用",
          detail,
          steps: [
            "关闭可能占用 1455 端口的本地程序。",
            "然后重新开始授权。",
          ],
          canOpenProxySettings: false,
        };
      case "open_browser_failed":
        return {
          kind,
          title: "无法打开浏览器",
          detail,
          steps: [
            "检查系统默认浏览器配置。",
            "确认浏览器可正常启动后，再重新开始授权。",
          ],
          canOpenProxySettings: false,
        };
      case "proxy_config":
        return {
          kind,
          title: "代理地址格式不对",
          detail,
          steps: [
            "打开设置，检查代理地址是否包含正确协议，例如 http:// 或 socks5://。",
            "保存后重新发起授权。",
          ],
          canOpenProxySettings: true,
        };
      case "client_build_failed":
        return {
          kind,
          title: "应用端网络初始化失败",
          detail,
          steps: [
            "先检查设置里的网络代理配置。",
            "如果代理没问题，再重新开始授权。",
          ],
          canOpenProxySettings: true,
        };
      case "region_restricted":
        return {
          kind,
          title: "当前网络出口地区不受支持",
          detail,
          steps: [
            "浏览器登录成功只代表拿到了 code，应用还需要继续向 OpenAI 换 token。",
            "去设置里检查网络代理，并确认应用端和浏览器端走的是同一条出口。",
            "调整后重新开始授权。",
          ],
          canOpenProxySettings: true,
        };
      case "network_timeout":
        return {
          kind,
          title: "连接 OpenAI 超时",
          detail,
          steps: [
            "先确认代理服务本身可用。",
            "再检查应用内代理配置是否正确。",
            "网络恢复后重新开始授权。",
          ],
          canOpenProxySettings: true,
        };
      case "network_connect":
        return {
          kind,
          title: "应用端无法完成 token exchange",
          detail,
          steps: [
            "浏览器可以打开授权页，不代表应用后端也能访问 OpenAI。",
            "检查设置里的网络代理，确认代理对当前应用生效。",
            "确认后重新开始授权。",
          ],
          canOpenProxySettings: true,
        };
      case "network_error":
        return {
          kind,
          title: "应用端网络请求失败",
          detail,
          steps: [
            "先确认当前网络与代理服务是否正常。",
            "如果浏览器已能授权，重点检查应用内代理是否也生效。",
            "确认后重新开始授权。",
          ],
          canOpenProxySettings: true,
        };
      case "browser_auth_error":
        return {
          kind,
          title: "浏览器授权没有完成",
          detail,
          steps: [
            "如果刚刚取消了登录或关闭了浏览器页面，直接重新开始即可。",
            "如果是第三方登录中断，完成登录后回到应用。",
          ],
          canOpenProxySettings: false,
        };
      case "state_mismatch":
        return {
          kind,
          title: "授权回调校验失败",
          detail,
          steps: [
            "关闭当前授权流程，重新开始一次。",
            "授权过程中尽量不要重复打开多个登录页面。",
          ],
          canOpenProxySettings: false,
        };
      case "timeout":
        return {
          kind,
          title: "等待浏览器回调超时",
          detail,
          steps: [
            "重新开始授权。",
            "浏览器完成登录后尽快回到应用，不要长时间停留在中间页。",
          ],
          canOpenProxySettings: false,
        };
      case "channel_closed":
        return {
          kind,
          title: "授权流程被中断",
          detail,
          steps: [
            "重新开始授权。",
            "如果反复出现，优先检查本机安全软件或系统弹窗是否拦截了流程。",
          ],
          canOpenProxySettings: false,
        };
      case "empty_code":
        return {
          kind,
          title: "没有拿到有效授权码",
          detail,
          steps: [
            "重新开始授权一次。",
            "如果浏览器里有多次跳转，等待最终完成页出现后再回到应用。",
          ],
          canOpenProxySettings: false,
        };
      case "token_exchange_failed":
        return {
          kind,
          title: "Token exchange 失败",
          detail,
          steps: [
            "先检查当前网络与代理设置。",
            "如果浏览器已提示授权完成，重点排查应用内代理是否可用。",
            "调整后重新开始授权。",
          ],
          canOpenProxySettings: true,
        };
      case "token_parse_failed":
        return {
          kind,
          title: "返回数据解析失败",
          detail,
          steps: [
            "先重试一次。",
            "如果持续出现，记录当前网络环境和代理配置再继续排查。",
          ],
          canOpenProxySettings: false,
        };
      default:
        return {
          kind: "generic",
          title: "添加账户失败",
          detail,
          steps: ["请重试一次；如果仍失败，再检查设置里的网络代理。"],
          canOpenProxySettings: false,
        };
    }
  };

  const handleCancel = async () => {
    if (isMountedRef.current) {
      setAddModalOpen(false);
    }

    if (loading) {
      void api.cancelOauthFlow().catch(() => {
        // The modal is already closed, so ignore cancellation transport errors here.
      });
    }
  };

  const handleAdd = async () => {
    if (!displayName.trim()) {
      showToast("请输入名称");
      return;
    }

    setOauthGuidance(null);
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

      showToast("已添加账户");
      if (isMountedRef.current) {
        setAddModalOpen(false);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isOauthCancelledError(message)) {
        const guidance = parseOauthGuidance(message);
        setOauthGuidance(guidance);
        showToast(`添加失败 · ${guidance.title}`);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleOpenProxySettings = () => {
    setAddModalOpen(false);
    setSettingsOpen(true);
  };

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-account-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          void handleCancel();
        }
      }}
    >
      <div
        className="dialog-shell w-full max-w-[720px] rounded-[34px] p-8 sm:p-9"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="relative mb-8 grid gap-6 lg:grid-cols-[0.96fr_1.04fr]">
          <div className="rounded-[28px] bg-[linear-gradient(155deg,rgba(21,26,34,0.98),rgba(35,46,58,0.94),rgba(92,105,122,0.76))] p-6 text-white shadow-[0_32px_72px_-46px_rgba(22,26,31,0.72)]">
            <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-white/12 text-white backdrop-blur-md">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 6l6 6-6 6" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 18h5" />
              </svg>
            </div>
            <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.32em] text-sky-100/72">OAuth</p>
            <h3 className="mt-3 text-[2rem] font-black tracking-[-0.06em]">
              接入新账号
            </h3>
          </div>

          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="eyebrow-chip">OAuth</span>
                <h2
                  id="add-account-title"
                  className="mt-4 text-[2.4rem] font-black tracking-[-0.07em] text-slate-950"
                >
                  添加账户
                </h2>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleCancel();
                }}
                className="glass-pill flex h-11 w-11 items-center justify-center rounded-full text-slate-500 transition-all hover:bg-white/80 hover:text-slate-900"
                aria-label={loading ? "取消授权并关闭" : "关闭添加账户"}
              >
                <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="relative grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="space-y-4">
            <div className="apple-panel-muted rounded-[28px] p-5">
              <label className="section-kicker tracking-[0.28em] text-slate-500">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (oauthGuidance) {
                    setOauthGuidance(null);
                  }
                }}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="例如：工作账号（主）"
                className="mt-3 w-full rounded-[22px] border border-slate-200/90 bg-white/84 px-4 py-3.5 text-base text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                autoFocus
              />
            </div>

            <div className="apple-panel rounded-[28px] p-5">
              <p className="section-kicker tracking-[0.28em]">Flow</p>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <p>命名后开始授权。</p>
                <p>完成登录后会自动加入账户列表。</p>
                <p>如果浏览器提示授权完成，但应用仍报 token exchange 失败，优先检查设置里的网络代理。</p>
              </div>
            </div>

            {oauthGuidance && (
              <div className="rounded-[28px] border border-amber-200 bg-amber-50/90 p-5 text-sm text-amber-900 shadow-[0_18px_40px_-34px_rgba(180,83,9,0.5)]">
                <p className="section-kicker tracking-[0.28em] text-amber-700">Recovery</p>
                <h3 className="mt-3 text-lg font-bold text-amber-950">{oauthGuidance.title}</h3>
                <p className="mt-2 leading-6">{oauthGuidance.detail}</p>
                <div className="mt-4 space-y-2 leading-6">
                  {oauthGuidance.steps.map((step) => (
                    <p key={step}>• {step}</p>
                  ))}
                </div>
                {oauthGuidance.canOpenProxySettings && (
                  <button
                    type="button"
                    onClick={handleOpenProxySettings}
                    className="mt-4 rounded-full border border-amber-300 bg-white/90 px-4 py-2.5 font-medium text-amber-900 transition-all hover:bg-white"
                  >
                    去设置网络代理
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="apple-panel rounded-[30px] p-5">
            <p className="section-kicker tracking-[0.28em]">Preview</p>
            <div className="mt-4 rounded-[28px] bg-[linear-gradient(155deg,rgba(255,255,255,0.82),rgba(240,249,255,0.94))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700/74">
                New
              </p>
              <p className="mt-3 truncate text-[1.45rem] font-black tracking-[-0.05em] text-slate-950">
                {displayName.trim() || "等待命名"}
              </p>
            </div>

            <p className="mt-4 rounded-[24px] border border-sky-100 bg-sky-50/85 px-4 py-3 text-sm leading-6 text-sky-800">
              不会覆盖你当前正在使用的共享会话。
            </p>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleCancel();
                }}
                className="glass-pill rounded-full px-5 py-3 text-sm font-medium text-slate-600 transition-all hover:bg-white/78 hover:text-slate-900"
              >
                {loading ? "取消授权" : "取消"}
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={loading}
                className="flex items-center gap-2 rounded-full bg-[linear-gradient(160deg,#07111f_0%,#163a72_58%,#3b82f6_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_20px_38px_-22px_rgba(15,23,42,0.86)] transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading && (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                )}
                {loading ? "授权中..." : "开始授权"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddAccountModal;
