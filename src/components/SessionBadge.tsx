import React, { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Account, SessionInfo } from "../types";
import { api } from "../utils/invoke";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: zhCN });
  } catch {
    return "未知";
  }
}

const SessionBadge: React.FC<{ account: Account }> = ({ account }) => {
  const [liveInfo, setLiveInfo] = useState<SessionInfo | null>(null);

  useEffect(() => {
    if (!account.isActive) return;
    api.getCurrentSessionsInfo().then(setLiveInfo).catch(console.error);
  }, [account.isActive]);

  const info = account.isActive ? liveInfo ?? account.sessionInfo : account.sessionInfo;

  if (!info) {
    return <span className="text-xs text-slate-400 italic">无会话信息</span>;
  }

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span>💬 {info.fileCount} sessions</span>
      <span className="opacity-30">·</span>
      <span>{formatBytes(info.totalBytes)}</span>
      {info.lastSessionObservedAt && (
        <>
          <span className="opacity-30">·</span>
          <span>最近记录 {formatRelative(info.lastSessionObservedAt)}</span>
        </>
      )}
    </div>
  );
};

export default SessionBadge;
