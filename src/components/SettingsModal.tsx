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
  const { setSettingsOpen, settings, platformCapabilities, settingsSaveState, updateSettings } =
    useAccountStore();
  const canAutoRestartCodex = platformCapabilities?.supportsAutoRestartCodexDesktop ?? false;
  const canAutoRestartVscode = platformCapabilities?.supportsAutoRestartVscode ?? false;

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
            <div className="apple-panel rounded-[30px] p-5">
              <p className="section-kicker tracking-[0.28em]">Workspace Behavior</p>
            </div>

            <div className="apple-panel-muted rounded-[28px] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    切换后自动重启 Codex
                  </label>
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
              <div className="flex items-start justify-between gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    切换后自动重启 VSCode
                  </label>
                </div>
                <button
                  type="button"
                  role="switch"
                  disabled={!canAutoRestartVscode}
                  aria-checked={settings.autoRestartVscodeAfterSwitch}
                  onClick={() =>
                    updateSettings({
                      autoRestartVscodeAfterSwitch: !settings.autoRestartVscodeAfterSwitch,
                    })
                  }
                  className={`liquid-toggle relative mt-1 inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-all ${
                    !canAutoRestartVscode
                      ? "bg-slate-200"
                      : settings.autoRestartVscodeAfterSwitch
                        ? "bg-[linear-gradient(135deg,#07111f,#2563eb)]"
                        : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-[0_10px_20px_-12px_rgba(15,23,42,0.55)] transition-transform ${
                      settings.autoRestartVscodeAfterSwitch ? "translate-x-7" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              {!canAutoRestartVscode && (
                <p className="mt-3 text-xs leading-6 text-amber-600">
                  当前平台暂不支持自动重启 VSCode。
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
                className="mt-3 w-full rounded-[22px] border border-slate-200/90 bg-white/84 px-4 py-3.5 text-base text-slate-900 outline-none transition-all focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
              >
                {REFRESH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-5">
            <div className="apple-panel rounded-[30px] p-5">
              <label className="section-kicker tracking-[0.28em] text-slate-500">
                网络代理
              </label>
              <input
                type="text"
                value={settings.proxyUrl}
                onChange={(event) => updateSettings({ proxyUrl: event.target.value })}
                placeholder="例如: http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                className="mt-3 w-full rounded-[22px] border border-slate-200/90 bg-white/84 px-4 py-3.5 text-base text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
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
