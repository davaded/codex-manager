import React from "react";
import { useAccountStore } from "../store/accountStore";

const REFRESH_OPTIONS = [
  { value: 0, label: "关闭" },
  { value: 5, label: "5 分钟" },
  { value: 15, label: "15 分钟" },
  { value: 30, label: "30 分钟" },
  { value: 60, label: "60 分钟" },
];

const SettingsModal: React.FC = () => {
  const { setSettingsOpen, settings, settingsSaveState, updateSettings } =
    useAccountStore();

  const saveStateLabel =
    settingsSaveState === "saving"
      ? "保存中..."
      : settingsSaveState === "saved"
        ? "已保存"
        : settingsSaveState === "error"
          ? "保存失败"
          : "自动保存";

  const saveStateClassName =
    settingsSaveState === "saving"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : settingsSaveState === "saved"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : settingsSaveState === "error"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-slate-200 bg-slate-50 text-slate-500";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-full max-w-xl rounded-[28px] border border-white/70 bg-white p-8 shadow-[0_28px_80px_-35px_rgba(15,23,42,0.5)]">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-indigo-500/80">
              Preferences
            </p>
            <h2
              id="settings-modal-title"
              className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950"
            >
              设置
            </h2>
            <p className="mt-2 text-sm leading-7 text-slate-500">
              调整主题和自动刷新节奏，让账户管理界面更贴合你的工作方式。
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-medium ${saveStateClassName}`}
            >
              {saveStateLabel}
            </span>
            <button
              onClick={() => setSettingsOpen(false)}
              className="rounded-2xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="关闭设置"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-7">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  切换后自动重启 Codex
                </label>
                <p className="mt-2 text-xs leading-6 text-slate-500">
                  开启后，账号切换成功会自动关闭并重新打开 Codex 桌面应用，让新账号立即生效。
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.autoRestartCodexAfterSwitch}
                onClick={() =>
                  updateSettings({
                    autoRestartCodexAfterSwitch: !settings.autoRestartCodexAfterSwitch,
                  })
                }
                className={`relative mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                  settings.autoRestartCodexAfterSwitch ? "bg-indigo-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    settings.autoRestartCodexAfterSwitch ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>

          <div>
            <label className="mb-3 block text-sm font-medium text-slate-700">
              自动刷新间隔
            </label>
            <select
              value={settings.autoRefreshInterval}
              onChange={(e) =>
                updateSettings({ autoRefreshInterval: Number(e.target.value) })
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition-all focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100"
            >
              {REFRESH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-3 block text-sm font-medium text-slate-700">
              网络代理
            </label>
            <input
              type="text"
              value={settings.proxyUrl}
              onChange={(event) => updateSettings({ proxyUrl: event.target.value })}
              placeholder="例如: http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100"
            />
            <p className="mt-2 text-xs leading-6 text-slate-500">
              用于 OAuth token 交换和后续需要网络请求的真实接口调用。
            </p>
          </div>

          <div>
            <label className="mb-3 block text-sm font-medium text-slate-700">
              主题
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["light", "dark", "system"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => updateSettings({ theme: t })}
                  className={`rounded-2xl border px-4 py-3 text-sm font-medium transition-all ${
                    settings.theme === t
                      ? "border-indigo-600 bg-indigo-600 text-white shadow-[0_18px_35px_-24px_rgba(79,70,229,0.85)]"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {t === "light" ? "浅色" : t === "dark" ? "深色" : "跟随系统"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
