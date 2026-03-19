# Codex Manager

多账号 **OpenAI/Codex CLI** 桌面管理器：**一键切换账号**，并在切换时继续复用当前 `~/.codex/sessions` 会话历史。

[![Release](https://img.shields.io/github/v/release/davaded/codex-manager?display_name=tag&sort=semver)](https://github.com/davaded/codex-manager/releases)
[![Downloads](https://img.shields.io/github/downloads/davaded/codex-manager/total)](https://github.com/davaded/codex-manager/releases)
[![License](https://img.shields.io/github/license/davaded/codex-manager)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/davaded/codex-manager/release.yml?branch=main)](https://github.com/davaded/codex-manager/actions)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](#installation)

![Codex Manager Preview](./docs/preview.png)

## Why（为什么做这个）

如果你有多个 Codex/OpenAI 账号，在 CLI 或桌面端之间切换通常会带来两件麻烦事：

- 账号切过去了，但很难确认当前到底用了哪一个身份
- 想比较各账号真实配额，往往得反复登录网页或靠猜

Codex Manager 把这些操作收成主窗口和托盘悬浮窗里的几个按钮。

## Features（你会用到的）

- ✅ OAuth 添加账号，不需要手动粘贴 `auth.json`
- ✅ 导入当前已经生效的 `~/.codex/auth.json`
- ✅ 每账号单独保存本地凭证
- ✅ 切换账号时保持共享 `~/.codex/sessions` 不变，只写入目标账号 `~/.codex/auth.json`
- ✅ 切换凭证失败时带回滚
- ✅ 可选在切换成功后自动关闭并重新打开 Codex 桌面应用
- ✅ 自动重启前提供确认提示，避免误中断当前桌面端会话
- ✅ 自动识别当前活跃账号
- ✅ 真实配额读取：展示 5 小时 / 每周已使用百分比，支持刷新
- ✅ 智能切换：按当前真实配额选择更合适的账号
- ✅ 托盘图标 + 半透明快速切换悬浮窗
- ✅ 导出备份 / 导入配置
- ✅ 设置持久化：主题、自动刷新频率、代理、切换后自动重启

## Installation

> 推荐：直接从 GitHub Releases 下载对应平台安装包。

- **Windows**：下载 `.msi`（或 `.exe`）安装
- **macOS**：下载 `.dmg`
- **Linux**：下载 `.AppImage` / `.deb` / `.rpm`（取决于发布的 target）

Releases：https://github.com/davaded/codex-manager/releases

### Notes

- 首次运行如果遇到系统安全提示，按系统提示允许打开即可。
- 应用会读写 `~/.codex/auth.json`，请确保 Codex CLI 已正确安装并能正常运行。

## 当前账号识别

应用会读取当前机器上的 `~/.codex/auth.json`，优先按以下顺序判断哪张卡是当前活跃账号：

1. `auth.json` 中解析出的 `email`
2. `auth.json` 中解析出的 `userId`
3. 已保存凭证中的 `chatgpt_account_id`
4. `refresh_token / access_token / id_token`

这样即使某张卡片对应的本地凭证文件没有刚好同步刷新，也能尽量识别出真正活跃的账号。

## 导入当前授权

“导入当前授权”不会重新发起 OAuth，而是直接读取当前机器上已经生效的 `~/.codex/auth.json`，把这份登录态登记成一个可管理账号。

导入时会：

1. 读取当前 `auth.json`
2. 解析 `email / userId / accountId`
3. 尝试匹配现有账号，避免重复导入
4. 保存凭证并立即刷新该账号的真实配额

如果当前授权本来就属于某个已有账号，则会更新该账号的凭证，而不是新建重复卡片。

## 智能切换

“智能切换”会先刷新当前账号列表的真实配额，再在拥有真实配额数据的账号中选择最佳候选。

当前规则：

- 优先选择 `5h` 已使用比例最低的账号
- 如果 `5h` 相同，则比较 `week` 已使用比例
- 如果当前活跃账号已经是最佳选择，则不会重复切换

## 托盘快速面板

桌面端现在会创建系统托盘图标，并提供一块快速面板。

![Tray Panel Demo](./docs/tray-panel-demo.png)

当前托盘能力：

- 左键点击托盘图标可打开/收起快速面板
- 点击快速面板外部会自动收起
- 托盘菜单操作不会再次误触发面板弹出
- 悬浮窗会按平台策略贴近托盘区域定位，Windows 下优先贴近任务栏边缘
- 菜单支持：
  - 打开快速面板
  - 打开主窗口
  - 收起快速面板
  - 退出应用
- 快速面板内支持：
  - 导入当前授权
  - 智能切换
  - 刷新用量
  - 查看所有账号并快速切换
  - 以更轻量的双列卡片查看账号状态与配额

当前托盘面板是一个轻量独立的半透明悬浮窗，用于快速切号和查看配额，不替代主窗口的完整管理视图。

## How it works（核心机制）

切换流程由 Tauri 后端串行执行，核心在 [`src-tauri/src/commands/sessions.rs`](./src-tauri/src/commands/sessions.rs)。

当前实现：

1. 读取当前共享 `~/.codex/sessions` 状态
2. 写入目标账号 `auth.json`
3. 保持当前共享会话仓库不变，继续使用同一套本地 session/thread
4. 如果设置开启，则在切换完成后自动重启 Codex 桌面应用

稳定性处理包括：

- 切换操作带全局锁，避免并发切换互相覆盖
- 写入 `auth.json` 失败会回滚到切换前凭证
- 前端不会再把“切换已成功，但本地 `accounts.json` 保存失败”误报成“切换失败”
- 自动重启开启时，前端会先弹确认框，明确提示会中断当前桌面端会话
- 自动重启失败不会回滚账号切换，但会明确提示用户手动重新打开 Codex

## Quota source（配额数据从哪来）

配额不是估算值，也不是前端 mock。

应用会使用每个账号自己的 `access_token + ChatGPT-Account-Id` 请求网页侧用量接口，读取真实配额窗口与重置时间。
如果某账号拉取失败，会明确显示失败原因，而不是展示“看起来对”的假数据。

## Data & Paths（数据在哪里）

应用数据保存在系统 App Data 目录。主要包括：

- `accounts.json`：账号列表和 UI 状态
- `settings.json`：主题、代理、自动刷新、切换后自动重启设置
- `credentials/<account-id>.json`：每个账号保存的凭证
- `sessions/<account-id>/`：旧版兼容快照目录，可逐步废弃

Codex CLI 的实时目录仍然是：

- `~/.codex/auth.json`：当前生效账号
- `~/.codex/sessions`：CLI 与桌面应用共享的当前活跃会话目录

## Development（本地开发）

前置依赖：

- Node.js 18+
- Rust stable
- Tauri v2 构建环境

安装依赖：

```bash
npm install
```

启动开发（Tauri）：

```bash
npm run tauri dev
```

仅前端预览：

```bash
npm run dev
```

生产构建检查：

```bash
npm run build
cd src-tauri
cargo check
```

## Roadmap（路线图）

- [ ] macOS / Linux 实机验证与打包
- [ ] OAuth 打开浏览器：从 `tauri-plugin-shell` 迁移到 `tauri-plugin-opener`
- [ ] 更完善的错误诊断（端口占用、权限不足、auth/sessions 目录异常等）
- [ ] 更细的托盘定位与平台特化体验

## Contributing（贡献）

欢迎 PR / Issue。

建议你在提交前做这些检查：

- `npm run build`
- `cargo check`（在 `src-tauri` 目录）

如果你要改切换逻辑/数据迁移，请在 PR 描述里补充：

- 失败场景如何回滚
- 是否影响现有本地数据结构

## Security notes（安全说明）

- 本项目会在本机保存账号凭证，**不应在不信任的机器上使用**
- 项目不主动把凭证上传到任何第三方；配额读取会请求 OpenAI 官方相关接口
- 如果你不希望本地保存凭证，请不要添加账号

## Known limitations（已知限制）

- OAuth 打开浏览器的实现目前仍使用 `tauri-plugin-shell` 的已弃用 `open` 接口，后续建议迁移到 `tauri-plugin-opener`
- 自动重启 Codex 桌面应用目前只在 Windows 下实现并验证
- 当前主要在 Windows 环境下完成验证，虽然代码按跨平台路径编写，但 macOS / Linux 还需要补实机验证
- README 描述的是桌面版真实能力；纯浏览器预览模式仍保留 mock fallback，仅用于看界面
