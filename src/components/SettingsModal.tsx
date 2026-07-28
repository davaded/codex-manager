import React from "react";
import { useAccountStore } from "../store/accountStore";

const REFRESH_OPTIONS = [
  { value: 0, label: "关闭" },
  { value: 5, label: "5 分钟" },
  { value: 15, label: "15 分钟" },
  { value: 30, label: "30 分钟" },
  { value: 60, label: "60 分钟" },
];

const PREHEAT_OPTIONS = [
  { value: 0, label: "关闭" },
  { value: 6, label: "每 6 小时" },
  { value: 12, label: "每 12 小时" },
  { value: 24, label: "每 24 小时" },
];

const SettingsModal: React.FC = () => {
  const { setSettingsOpen, settings, platformCapabilities, settingsSaveState, updateSettings } =
    useAccountStore();
  const canAutoRestartCodex = platformCapabilities?.supportsAutoRestartCodexDesktop ?? false;

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
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="dialog-shell w-full max-w-[820px] rounded-[34px] p-8 sm:p-9">
        <div className="relative mb-8 flex items-start justify-between gap-4">
          <div>
            <span className="eyebrow-chip">Preferences</span>
            <h2
              id="settings-modal-title"
              className="mt-4 text-[2.5rem] font-black tracking-[-0.07em] text-slate-950"
            >
              设置
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-medium ${saveStateClassName}`}
            >
              {saveStateLabel}
            </span>
            <button
              onClick={() => setSettingsOpen(false)}
              className="glass-pill flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition-all hover:bg-white/78 hover:text-slate-700"
              aria-label="关闭设置"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.04fr_0.96fr]">
          <div className="space-y-5">
            <div className="apple-panel rounded-[30px] border-dashed p-5">
              <p className="section-kicker tracking-[0.28em]">Workspace Behavior</p>
            </div>

            <div className="apple-panel-muted rounded-[28px] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  兼容模式：切换后重启 Codex
                </label>
                <p className="mt-2 max-w-[28rem] text-xs leading-6 text-slate-500">
                  默认推荐无感热切换：只替换 <code>~/.codex/auth.json</code>，不关闭 Codex。
                  如果桌面端仍沿用旧登录态，再开启这个兜底项。
                </p>
              </div>
              <button
                type="button"
                role="switch"
                disabled={!canAutoRestartCodex}
                aria-checked={settings.autoRestartCodexAfterSwitch}
                onClick={() =>
                  updateSettings({
                    autoRestartCodexAfterSwitch: !settings.autoRestartCodexAfterSwitch,
                  })
                }
                className={`liquid-toggle relative mt-1 inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-all ${
                  !canAutoRestartCodex
                    ? "bg-slate-200"
                    : settings.autoRestartCodexAfterSwitch
                      ? "bg-[linear-gradient(135deg,#07111f,#2563eb)]"
                      : "bg-slate-300"
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-[0_10px_20px_-12px_rgba(15,23,42,0.55)] transition-transform ${
                    settings.autoRestartCodexAfterSwitch ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {!canAutoRestartCodex && (
              <p className="mt-3 text-xs leading-6 text-amber-600">
                当前平台暂不支持自动重启。
              </p>
            )}
          </div>

            <div className="apple-panel-muted rounded-[28px] p-5">
              <label className="section-kicker tracking-[0.28em] text-slate-500">
                自动刷新间隔
              </label>
              <select
                value={settings.autoRefreshInterval}
                onChange={(e) =>
                  updateSettings({ autoRefreshInterval: Number(e.target.value) })
                }
                className="clay-field mt-3 w-full rounded-[22px] px-4 py-3.5 text-base text-slate-900 outline-none transition-all"
              >
                {REFRESH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="apple-panel-muted rounded-[28px] p-5">
              <label className="section-kicker tracking-[0.28em] text-slate-500">
                自动预热检查
              </label>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                仅对还没进入每周窗口倒计时的账号发送一次轻量请求，避免重复消耗。
              </p>
              <select
                value={settings.autoPreheatIntervalHours}
                onChange={(e) =>
                  updateSettings({ autoPreheatIntervalHours: Number(e.target.value) })
                }
                className="clay-field mt-3 w-full rounded-[22px] px-4 py-3.5 text-base text-slate-900 outline-none transition-all"
              >
                {PREHEAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-5">
            <div className="apple-panel rounded-[30px] border-dashed p-5">
              <label className="section-kicker tracking-[0.28em] text-slate-500">
                网络代理
              </label>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                这里的代理会用于应用内请求，包括 OAuth token exchange。
                浏览器里看到“授权完成”并不代表应用端一定已经换到 token。
              </p>
              <input
                type="text"
                value={settings.proxyUrl}
                onChange={(event) => updateSettings({ proxyUrl: event.target.value })}
                placeholder="例如: http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                className="clay-field mt-3 w-full rounded-[22px] px-4 py-3.5 text-base text-slate-900 outline-none transition-all placeholder:text-slate-400"
              />
            </div>

            <div className="apple-panel-muted rounded-[30px] p-5">
              <label className="section-kicker tracking-[0.28em] text-slate-500">
                主题
              </label>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {(["light", "dark", "system"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => updateSettings({ theme: t })}
                    className={`rounded-[24px] border px-4 py-4 text-sm font-medium transition-all ${
                      settings.theme === t
                        ? "border-slate-950 bg-slate-950 text-white shadow-[0_18px_35px_-24px_rgba(15,23,42,0.75)]"
                        : "border-white/80 bg-white/78 text-slate-600 hover:border-slate-300 hover:bg-white"
                    }`}
                  >
                    <span className="block">
                      {t === "light" ? "浅色" : t === "dark" ? "深色" : "跟随系统"}
                    </span>
                    <span className="mt-1 block text-xs opacity-70">
                      {t === "light" ? "浅色" : t === "dark" ? "深色" : "自动"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
