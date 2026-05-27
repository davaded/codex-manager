import { create } from "zustand";
import { Account, AppSettings, DesktopPlatformCapabilities, SwitchState } from "../types";

interface AccountStoreState {
  accounts: Account[];
  switchState: SwitchState;
  toastMessage: string | null;
  isAddModalOpen: boolean;
  isSettingsOpen: boolean;
  settings: AppSettings;
  platformCapabilities: DesktopPlatformCapabilities | null;
  settingsSaveState: "idle" | "saving" | "saved" | "error";

  setAccounts: (accounts: Account[]) => void;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  removeAccount: (id: string) => void;
  setSwitchState: (state: Partial<SwitchState>) => void;
  showToast: (message: string) => void;
  setAddModalOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettings: (settings: AppSettings) => void;
  setPlatformCapabilities: (capabilities: DesktopPlatformCapabilities) => void;
  setSettingsSaveState: (
    state: "idle" | "saving" | "saved" | "error",
  ) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
}

const initialSwitchState: SwitchState = {
  phase: "idle",
  fromAccountId: null,
  toAccountId: null,
  error: null,
  snapshotResult: null,
  restoreResult: null,
};

const defaultSettings: AppSettings = {
  autoRefreshInterval: 0,
  autoRestartCodexAfterSwitch: true,
  autoRestartVscodeAfterSwitch: false,
  theme: "system",
  proxyUrl: "",
};

// Module-level timer handle to prevent overlapping toast dismissals
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useAccountStore = create<AccountStoreState>((set) => ({
  accounts: [],
  switchState: initialSwitchState,
  toastMessage: null,
  isAddModalOpen: false,
  isSettingsOpen: false,
  settings: defaultSettings,
  platformCapabilities: null,
  settingsSaveState: "idle",

  setAccounts: (accounts) => set({ accounts }),
  updateAccount: (id, updates) =>
    set((state) => ({
      accounts: state.accounts.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    })),
  removeAccount: (id) =>
    set((state) => ({ accounts: state.accounts.filter((a) => a.id !== id) })),
  setSwitchState: (updates) =>
    set((state) => ({ switchState: { ...state.switchState, ...updates } })),
  showToast: (message) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toastMessage: message });
    toastTimer = setTimeout(() => set({ toastMessage: null }), 3000);
  },
  setAddModalOpen: (open) => set({ isAddModalOpen: open }),
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  setSettings: (settings) => set({ settings }),
  setPlatformCapabilities: (platformCapabilities) => set({ platformCapabilities }),
  setSettingsSaveState: (settingsSaveState) => set({ settingsSaveState }),
  updateSettings: (updates) =>
    set((state) => ({ settings: { ...state.settings, ...updates } })),
}));
