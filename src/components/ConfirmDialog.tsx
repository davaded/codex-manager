import React from "react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel = "确认",
  tone = "danger",
  onConfirm,
  onCancel,
}) => (
<div
    className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-md"
    role="dialog"
    aria-modal="true"
    aria-labelledby="confirm-dialog-title"
  >
    <div className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-8 shadow-[0_28px_80px_-35px_rgba(15,23,42,0.5)]">
      <p
        className={`text-sm font-semibold uppercase tracking-[0.3em] ${
          tone === "danger" ? "text-red-500/80" : "text-indigo-500/80"
        }`}
      >
        {tone === "danger" ? "Danger Zone" : "Please Confirm"}
      </p>
      <h2
        id="confirm-dialog-title"
        className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-950"
      >
        {title}
      </h2>
      <p className="mb-6 mt-2 text-sm leading-7 text-slate-500">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="rounded-2xl px-4 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          className={`rounded-2xl px-4 py-3 text-sm font-medium text-white transition-colors ${
            tone === "danger"
              ? "bg-red-500 hover:bg-red-600"
              : "bg-indigo-600 hover:bg-indigo-700"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

export default ConfirmDialog;
