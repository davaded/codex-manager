# Codex Manager — 实现计划

## 项目目标

管理多个 OpenAI Codex CLI 账号，核心痛点：**切换账号时保留每个账号的对话历史/上下文**。

---

## 核心差异点（对比 codex-auth-manager）

| 特性 | codex-auth-manager | codex-manager |
|---|---|---|
| 平台 | Windows only | Windows + macOS + Linux |
| 添加账号 | 手动粘贴 auth.json | ✅ OAuth 授权流程 |
| Session 隔离 | 无 | ✅ 每账号独立保存/恢复 |
| 切换时上下文 | 丢失 | ✅ 自动快照+还原 |
| 切换回滚 | 无 | ✅ 失败自动回滚 |

---

## OAuth 登录流程

### 端点与参数（逆向自 Codex CLI 官方实现）

| 参数 | 值 |
|---|---|
| 授权端点 | `https://auth.openai.com/oauth/authorize` |
| Token 端点 | `https://auth.openai.com/oauth/token` |
| Redirect URI | `http://localhost:1455/auth/callback`（**端口硬编码**）|
| `client_id` | `app_EMoamEEZ73f0CkXaXp7hrann` |
| `response_type` | `code` |
| `scope` | `openid profile email offline_access` |
| `code_challenge_method` | `S256`（PKCE）|
| 自定义参数 | `codex_cli_simplified_flow=true` `originator=codex_cli_rs` |

### PKCE 实现
- `code_verifier`：Base64url 编码的 32 字节随机数
- `code_challenge`：`BASE64URL(SHA256(code_verifier))`

### 添加账号流程

```
用户点击"添加账号"
        │
        ▼
Rust：生成 code_verifier / code_challenge / state（CSRF）
        │
        ▼
Rust：启动本地 HTTP 服务监听 localhost:1455
        │
        ▼
打开浏览器 → https://auth.openai.com/oauth/authorize?...
        │
        ▼
用户在浏览器完成 OpenAI 登录
        │
        ▼
浏览器重定向 → http://localhost:1455/auth/callback?code=...&state=...
        │
        ▼
Rust：验证 state，POST token 端点换取 access_token + refresh_token
        │
        ▼
Rust：解析 JWT 提取 account_id / email，写入凭证文件，关闭 HTTP 服务
        │
        ▼
前端收到通知，新账号出现在列表
```

> **注意**：端口 1455 硬编码，需要确保该端口未被占用。
> 若已有其他 Codex 进程运行，可能冲突，需要提前检测并提示用户。

### `~/.codex/auth.json` 格式（Schema A，官方）

```json
{
  "auth_mode": "chatgpt",
  "tokens": {
    "access_token": "eyJ...",
    "id_token": "eyJ...",
    "refresh_token": "rt_..."
  },
  "last_refresh": 1761735358000
}
```

- `access_token`：JWT，有效期约 1 小时
- `refresh_token`：长期有效，前缀 `rt_...`
- `account_id`：从 JWT payload 的 `chatgpt_account_id` 字段提取
- Token 超过 ~8 天不刷新会失效

### 相关 Rust 依赖

```toml
sha2 = "0.10"                        # SHA-256 for PKCE
base64 = "0.22"                      # base64url encoding
rand = "0.8"                         # code_verifier random bytes
tokio = { version = "1", features = ["full"] }   # async HTTP server
axum = "0.7"                         # 轻量 HTTP server（接收 callback）
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
jsonwebtoken = "9"                   # 解析 JWT 提取 account_id/email
```

---

## 完整功能列表

### 核心功能
- **OAuth 登录添加账号**（浏览器授权流程）
- **一键切换账号**（3阶段原子操作：快照→还原→写凭证）
- **对话历史隔离**（每账号独立 sessions 快照）
- 切换失败自动回滚

### 账号管理
- 添加账号（OAuth）
- 删除账号（清除凭证 + sessions 快照）
- 编辑显示名称

### 用量监控
- 查询 `wham/usage` API，显示 5小时 / 周配额进度条
- 推荐剩余配额最多的账号
- 手动刷新 + 自动刷新（可配置间隔）

### 备份/恢复
- 导出所有账号元数据 + 凭证为单 JSON 文件
- 从备份文件导入

### 设置
- 自动刷新间隔
- 代理（HTTP / SOCKS）
- 主题（亮/暗/跟随系统）

### 其他
- 启动时自动识别当前活跃账号
- Toast 通知

---

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面框架 | Tauri 2 | ~2.x |
| 前端语言 | TypeScript | ~5.x |
| UI 框架 | React | 19.x |
| 样式 | Tailwind CSS | 4.x |
| 状态管理 | Zustand | 5.x |
| 构建工具 | Vite | 7.x |
| 后端语言 | Rust | ≥1.77 |
| 异步运行时 | Tokio | 1.x |
| 目录遍历 | walkdir | 2.x |
| 时间处理 | chrono | 0.4 |
| UUID 生成 | uuid | 1.x（feature: v4）|
| 跨平台路径 | dirs | 5.x |

---

## 项目结构

```
codex-manager/
├── src/                            # React 前端
│   ├── components/
│   │   ├── AccountCard.tsx         # 账号卡片（含 session 信息、切换按钮）
│   │   ├── AccountList.tsx         # 账号列表容器
│   │   ├── AddAccountModal.tsx     # 添加账号弹窗
│   │   ├── ConfirmDialog.tsx       # 通用确认弹窗
│   │   ├── EmptyState.tsx          # 无账号时的占位界面
│   │   ├── Header.tsx              # 顶栏（当前账号、刷新按钮）
│   │   ├── SessionBadge.tsx        # Session 文件数 + 最后快照时间
│   │   ├── SettingsModal.tsx       # 设置弹窗
│   │   ├── SwitchProgress.tsx      # 切换进度遮罩（3阶段状态）
│   │   └── Toast.tsx               # 轻提示
│   ├── hooks/
│   │   └── useAccountSwitch.ts     # 切换流程编排 hook
│   ├── store/
│   │   └── accountStore.ts         # Zustand store（账号列表、切换状态）
│   ├── types/
│   │   └── index.ts                # 所有 TypeScript 类型定义
│   ├── utils/
│   │   └── invoke.ts               # Tauri invoke 封装（类型安全）
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── src-tauri/
│   ├── capabilities/
│   │   └── default.json            # Tauri 2 权限声明
│   ├── icons/                      # 应用图标
│   ├── src/
│   │   ├── main.rs                 # Tauri app 入口
│   │   ├── lib.rs                  # 注册所有 commands
│   │   ├── models.rs               # 共享数据结构（Serialize/Deserialize）
│   │   └── commands/
│   │       ├── mod.rs
│   │       ├── paths.rs            # 跨平台路径解析
│   │       ├── accounts.rs         # 账号 CRUD、auth.json 读写
│   │       └── sessions.rs         # 核心：快照、还原、switch_account
│   ├── Cargo.toml
│   └── tauri.conf.json
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── PLAN.md
```

---

## 数据模型

### TypeScript（`src/types/index.ts`）

```typescript
interface Account {
  id: string;                        // UUID v4
  displayName: string;               // 用户自定义名称
  email: string | null;              // 从 auth.json 解析
  userId: string | null;             // auth.json 中的 account_id
  isActive: boolean;
  createdAt: string;                 // ISO 8601
  lastSwitchedAt: string | null;
  sessionInfo: SessionInfo | null;   // 最后一次快照的统计
}

interface SessionInfo {
  fileCount: number;
  totalBytes: number;
  lastSnapshotAt: string | null;
}

// 存储在 credentials/<id>.json，不放入 accounts.json
interface AccountCredentials {
  accountId: string;
  authJson: string;                  // ~/.codex/auth.json 的原始内容
}

interface AccountsStore {
  version: string;
  accounts: Account[];
}

// 切换状态机
type SwitchPhase =
  | 'idle'
  | 'snapshotting'   // Phase 1: 保存当前 sessions
  | 'restoring'      // Phase 2: 还原目标 sessions
  | 'writing_auth'   // Phase 3: 写入 auth.json
  | 'done'
  | 'error';

interface SwitchState {
  phase: SwitchPhase;
  fromAccountId: string | null;
  toAccountId: string | null;
  error: string | null;
  snapshotResult: SnapshotResult | null;
  restoreResult: RestoreResult | null;
}

interface SnapshotResult {
  fileCount: number;
  totalBytes: number;
  snapshotTime: string;
}

interface RestoreResult {
  fileCount: number;
  totalBytes: number;
  restoreTime: string;
}

interface SwitchResult {
  success: boolean;
  snapshot: SnapshotResult;
  restore: RestoreResult;
  error: string | null;
}
```

### Rust 结构体（`src-tauri/src/models.rs`）

```rust
pub struct Account {
    pub id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub user_id: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub last_switched_at: Option<String>,
    pub session_info: Option<SessionInfo>,
}

pub struct SessionInfo {
    pub file_count: u32,
    pub total_bytes: u64,
    pub last_snapshot_at: Option<String>,
}

pub struct AccountsStore {
    pub version: String,
    pub accounts: Vec<Account>,
}

pub struct SnapshotResult {
    pub file_count: u32,
    pub total_bytes: u64,
    pub snapshot_time: String,
}

pub struct RestoreResult {
    pub file_count: u32,
    pub total_bytes: u64,
    pub restore_time: String,
}

pub struct SwitchResult {
    pub success: bool,
    pub snapshot: SnapshotResult,
    pub restore: RestoreResult,
    pub error: Option<String>,
}

// ~/.codex/auth.json 结构（用于解析验证）
pub struct AuthJson {
    pub tokens: Option<AuthTokens>,
}

pub struct AuthTokens {
    pub access_token: Option<String>,
    pub account_id: Option<String>,
    pub token_type: Option<String>,
}

// 存储在 <app_data>/sessions/<id>/.snapshot_meta.json
pub struct SnapshotMeta {
    pub file_count: u32,
    pub total_bytes: u64,
    pub snapshot_at: String,
}
```

---

## Rust Commands

### `commands/paths.rs`
| Command | 说明 |
|---|---|
| `get_codex_dir` | `~/.codex/` 的绝对路径 |
| `get_sessions_dir` | `~/.codex/sessions/` |
| `get_account_sessions_dir(id)` | `<app_data>/sessions/<id>/` |

跨平台实现：
- `~/.codex/` → `dirs::home_dir().join(".codex")`
- App data → Tauri `app.path().app_data_dir()`（自动适配三平台）

### `commands/accounts.rs`
| Command | 说明 |
|---|---|
| `load_accounts` | 读 `<app_data>/accounts.json` |
| `save_accounts(data)` | 写 `<app_data>/accounts.json` |
| `read_auth_json` | 读 `~/.codex/auth.json` |
| `write_auth_json(content)` | 写 `~/.codex/auth.json` |
| `save_account_credentials(id, content)` | 写 `<app_data>/credentials/<id>.json` |
| `read_account_credentials(id)` | 读凭证文件 |
| `delete_account_credentials(id)` | 删凭证文件 |

### `commands/sessions.rs`（核心）
| Command | 说明 |
|---|---|
| `snapshot_sessions(account_id)` | 当前 sessions → 账号快照目录 |
| `restore_sessions(account_id)` | 账号快照目录 → 当前 sessions |
| `switch_account(from_id, to_id, to_auth)` | 原子切换（3阶段 + 回滚）|
| `list_account_session_info(id)` | 返回快照的文件数/大小/时间 |
| `get_current_sessions_info` | 当前 live sessions 统计 |
| `delete_account_sessions(id)` | 删除账号的快照数据 |

---

## 账号切换详细流程

```
用户点击"切换到账号 B"
        │
        ▼
前端：检查 from ≠ to，读取 B 的凭证
        │
        ▼
Zustand：phase = 'snapshotting'，打开 SwitchProgress 遮罩
        │
        ▼
invoke('switch_account', { from_id: A, to_id: B, to_auth: B_json })
        │
        ├─ [Rust Phase 1] snapshot_sessions(A)
        │    ~/.codex/sessions/ ──copy──▶ <app_data>/sessions/A/
        │    写 .snapshot_meta.json
        │
        ├─ [Rust Phase 2] restore_sessions(B)
        │    remove_dir_all(~/.codex/sessions/)
        │    create_dir_all(~/.codex/sessions/)
        │    <app_data>/sessions/B/ ──copy──▶ ~/.codex/sessions/
        │    （B 无快照时：创建空目录）
        │
        ├─ [Rust Phase 3] write_auth_json(B_json)
        │    写 ~/.codex/auth.json
        │
        └─ 返回 SwitchResult
                │
                ▼
前端：更新 Zustand（isActive、lastSwitchedAt、sessionInfo）
      save_accounts() 持久化
      phase = 'done' → 1.5s 后关闭遮罩
```

### 回滚策略

| 失败阶段 | 回滚动作 |
|---|---|
| Phase 1 失败 | 无需回滚（源目录未修改） |
| Phase 2 失败 | 从 A 的快照还原 `~/.codex/sessions/` |
| Phase 3 失败 | 还原 A 的 sessions + 还原 A 的 auth.json |

---

## 跨平台路径

| 平台 | `~/.codex/` | App Data |
|---|---|---|
| Windows | `C:\Users\<user>\.codex\` | `%APPDATA%\codex-manager\` |
| macOS | `/Users/<user>/.codex/` | `~/Library/Application Support/codex-manager/` |
| Linux | `/home/<user>/.codex/` | `~/.local/share/codex-manager/` |

**原则：**
- 所有路径操作在 Rust 侧完成，用 `PathBuf::join()` 保证分隔符正确
- 前端不构建任何路径，只传 `account_id` 等语义参数
- 目录复制用 `walkdir` + `std::fs::copy`，不调用 shell 命令

---

## UI 组件说明

### `SwitchProgress.tsx`（切换进度遮罩）
```
┌─────────────────────────────┐
│  正在切换到 "Work Account"  │
│                             │
│  ✅ 保存当前对话历史...     │
│  ⏳ 还原目标对话历史...     │
│  ⬜ 更新登录凭证           │
└─────────────────────────────┘
```

### `AccountCard.tsx`
```
┌──────────────────────────────────────┐
│  🟢 Work Account          [ACTIVE]   │
│  user@example.com                    │
│  💬 34 sessions  •  最后快照 2min前  │
│                          [切换] [删] │
└──────────────────────────────────────┘
```

### `SessionBadge.tsx`
- 显示：快照文件数、总大小、最后快照时间
- 当前活跃账号显示 live 数据（从 `get_current_sessions_info` 获取）

---

## 实现顺序

### Phase 1：脚手架
- [ ] `npm create tauri-app@latest` 初始化项目
- [ ] 配置 Tailwind 4 + Zustand
- [ ] 配置 `tauri.conf.json`（窗口大小、应用名）
- [ ] 配置 `capabilities/default.json`（文件系统权限）

### Phase 2：Rust 后端
- [ ] `models.rs` — 所有数据结构
- [ ] `commands/paths.rs` — 路径解析基础
- [ ] `commands/accounts.rs` — 账号 CRUD
- [ ] `commands/sessions.rs` — snapshot / restore
- [ ] `switch_account` 原子命令 + 回滚逻辑
- [ ] `lib.rs` — 注册所有 commands

### Phase 3：前端
- [ ] `src/types/index.ts` — TypeScript 类型
- [ ] `src/utils/invoke.ts` — 类型安全的 invoke 封装
- [ ] `accountStore.ts` — Zustand store
- [ ] 静态 UI 组件（AccountCard、SwitchProgress、AddAccountModal）
- [ ] `useAccountSwitch.ts` — 切换流程编排
- [ ] 连接真实 Tauri invoke 调用

### Phase 4：测试与打包
- [ ] 本机 Windows / macOS / Linux 路径测试
- [ ] 切换流程端到端测试（含失败回滚场景）
- [ ] `tauri build` 打包三平台产物

---

## 本地数据存储结构

```
<app_data>/
├── accounts.json              # 账号列表（不含凭证）
├── credentials/
│   ├── <account_id_1>.json    # 账号 A 的 auth.json 内容
│   └── <account_id_2>.json    # 账号 B 的 auth.json 内容
└── sessions/
    ├── <account_id_1>/        # 账号 A 的 sessions 快照
    │   ├── .snapshot_meta.json
    │   └── <session_files...>
    └── <account_id_2>/        # 账号 B 的 sessions 快照
        ├── .snapshot_meta.json
        └── <session_files...>
```

---

## 安全说明

- 凭证（auth token）明文存储在本地 app data 目录（与 codex-auth-manager 相同）
- 不对外网络传输任何凭证
- 所有文件操作限制在 `~/.codex/` 和 app data 目录内
