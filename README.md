# Codex Manager

一个用于管理多个 Codex 账号的桌面与命令行工具，支持在桌面端和命令行中进行账号切换、配额查看与管理。

[English](./README.en.md)

[![Release](https://img.shields.io/github/v/release/davaded/codex-manager?display_name=tag&sort=semver)](https://github.com/davaded/codex-manager/releases)
[![Downloads](https://img.shields.io/github/downloads/davaded/codex-manager/total)](https://github.com/davaded/codex-manager/releases)
[![License](https://img.shields.io/github/license/davaded/codex-manager)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/davaded/codex-manager/release.yml?branch=main)](https://github.com/davaded/codex-manager/actions)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](#安装)

## 预览

主窗口：

<img src="./docs/preview.png" alt="Codex Manager Preview" width="960" />

托盘快捷面板：

<img src="./docs/tray-panel-demo.png" alt="Tray Panel Demo" width="420" />

## 为什么做这个

如果你同时使用多个 Codex / OpenAI 账号，通常会遇到两个问题：

- 很难确认当前到底在用哪个账号
- 很难比较每个账号的真实额度和使用情况

Codex Manager 把这些操作收敛成桌面窗口、托盘面板和命令行里的几个动作。

## 功能

- 通过 OAuth 添加账号，或导入当前 `~/.codex/auth.json`
- 检测“当前正在使用但尚未纳管”的账号
- 一键导入当前本地授权
- 切换账号时保留共享的 `~/.codex/sessions`
- 读取真实的 5 小时 / 每周额度数据
- 支持全局刷新和单账号刷新
- 支持按额度情况执行 Smart Switch
- 提供托盘快捷面板
- 支持切换后按设置重启 Codex Desktop
- 支持备份导出和设置持久化
- 安装后可通过 `codex-manager` 命令行切换账号

## 安装

推荐直接从 GitHub Releases 下载打包产物：

- Windows：`.msi` 或 `.exe`
- macOS：`.pkg` 或 `.dmg`
- Linux：`.deb`、`.rpm` 或 `.AppImage`

下载地址：<https://github.com/davaded/codex-manager/releases>

### 安装后 CLI 可用性

安装完成后，`codex-manager` 命令在各平台的行为如下：

| 平台 | 推荐安装包 | CLI 可用性 |
| --- | --- | --- |
| Windows | `.exe` 或 `.msi` | 自动加入 `PATH` |
| macOS | `.pkg` | 自动链接到 `/usr/local/bin/codex-manager` |
| macOS | `.dmg` | 需要额外执行一次 helper 脚本 |
| Linux | `.deb` 或 `.rpm` | 安装后可直接使用 `codex-manager` |
| Linux | `.AppImage` | 需要额外执行一次 helper 脚本，或保持便携运行 |

说明：

- Windows 安装后请重新打开一个终端窗口，让新的 `PATH` 生效。
- macOS 如果希望安装完成后立刻在 Terminal 里使用 `codex-manager`，优先下载 `.pkg`。
- Linux 如果希望获得最稳定的系统级 CLI 体验，优先使用 `.deb` 或 `.rpm`。
- 应用会读写 `~/.codex/auth.json`，所以机器上需要先能正常使用 Codex CLI。

## 命令行切换

现在支持直接在终端里切换受管账号：

```bash
codex-manager list
codex-manager switch work
codex-manager switch dev@company.com
codex-manager switch 2
```

CLI 会同时更新受管账号状态和当前生效的 `~/.codex/auth.json`。

如果 Codex CLI 或桌面应用已经在运行，切换后请重启它们，让新的 auth 生效。

对于 `.dmg` 和 `.AppImage` 安装方式，可以使用发布包里的 helper 脚本暴露全局命令：

```bash
sudo bash ./install-unix-cli.sh /Applications/codex-manager.app /usr/local/bin/codex-manager
```

如果你是在仓库本地开发，也可以继续用：

```bash
npm link
```

这个本地命令现在只是一个薄包装，会转发到仓库里的 Rust CLI 实现；首次使用前需要本机可用 `cargo`。

## 快速开始

1. 打开 Codex Manager
2. 导入当前授权，或通过 OAuth 添加账号
3. 刷新额度数据
4. 手动切换、执行 Smart Switch，或者直接用 `codex-manager switch ...`

## 当前账号识别

应用会读取当前机器上的 `~/.codex/auth.json`，按下面顺序识别当前账号：

1. `email`
2. `userId`
3. 已保存凭证中的 `chatgpt_account_id`
4. `refresh_token / access_token / id_token`

如果当前 live auth 无法匹配到任何受管账号，但又能识别出身份，界面会把它显示为“当前未纳管账号”，而不是错误地把旧账号继续标成 active。

## 导入当前授权

“导入当前授权”会直接读取已经生效的 `~/.codex/auth.json`，并把它登记成一个可管理账号。

导入时会：

1. 读取当前 `auth.json`
2. 解析 `email / userId / accountId`
3. 匹配已有账号，避免重复导入
4. 保存凭证并刷新额度数据

如果当前授权本来就属于某个已有账号，则更新该账号，而不是创建重复卡片。

## Smart Switch

“Smart Switch”会先刷新额度，再在拥有有效数据的账号里选择当前更合适的候选。

当前规则：

- 优先选择 `5h` 使用比例更低的账号
- 如果 `5h` 相同，再比较每周使用比例
- 如果当前账号已经是最佳选择，则不重复切换

## 托盘面板

应用会创建系统托盘图标和快捷面板。

当前行为：

- 左键点击托盘图标可打开或收起面板
- 点击面板外部会自动收起
- 托盘菜单操作不会误触发面板再次弹出
- 面板会按平台策略贴近托盘区域
- 可以在面板中导入当前授权、执行 Smart Switch、刷新额度和快速切换账号

## 工作原理

切换逻辑由 Tauri 后端串行处理，核心代码在 [`src-tauri/src/commands/sessions.rs`](./src-tauri/src/commands/sessions.rs)。

当前流程：

1. 读取当前共享的 `~/.codex/sessions`
2. 写入目标账号的 `auth.json`
3. 保持共享 session 工作集不变
4. 如果设置开启，则切换后重启 Codex Desktop

稳定性保障：

- 全局锁避免并发切换
- 写入 `auth.json` 失败会回滚
- 本地持久化失败不会把切换误判成失败
- 自动重启前会弹确认
- 自动重启失败不会撤销账号切换

## 数据与路径

应用数据保存在系统 App Data 目录。主要文件包括：

- `accounts.json`：账号列表和 UI 状态
- `settings.json`：主题、代理、自动刷新、切换后自动重启等设置
- `credentials/<account-id>.json`：每个账号保存的凭证
- `sessions/<account-id>/`：旧版兼容会话目录

实时生效的 Codex 目录仍然是：

- `~/.codex/auth.json`：当前激活账号
- `~/.codex/sessions`：CLI 与桌面应用共享的会话目录

## 开发

前置依赖：

- Node.js 18+
- Rust stable
- Tauri v2 构建环境

安装依赖：

```bash
npm install
```

启动 Tauri 开发环境：

```bash
npm run tauri dev
```

只跑前端：

```bash
npm run dev
```

构建检查：

```bash
npm run build
cd src-tauri
cargo check
```

## 路线图

- 继续补齐 macOS / Linux 安装器的实机验证
- 将 OAuth 打开浏览器逻辑从 `tauri-plugin-shell` 迁移到 `tauri-plugin-opener`
- 增强端口冲突、权限异常、auth/session 目录异常的诊断
- 继续打磨托盘定位和各平台桌面体验

## 安全说明

- 应用会在本地保存账号凭证，不建议在不受信任的机器上使用
- 项目不会主动把凭证上传到第三方；额度读取仅请求 OpenAI 相关接口
- 如果你不希望本地保存凭证，请不要添加账号

## 已知限制

- OAuth 打开浏览器目前仍在使用已废弃的 `tauri-plugin-shell` `open` API
- 自动重启 Codex Desktop 当前主要在 Windows 上完成验证
- 安装器的端到端验证目前仍以 Windows 为主，macOS / Linux 还需要更多实机测试
- 浏览器预览模式仍保留 mock fallback，仅用于界面预览
