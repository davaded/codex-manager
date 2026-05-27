use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::{thread, time::Duration};

use crate::models::DesktopPlatformCapabilities;

fn path_has_file(path: &Path) -> bool {
    path.is_file()
}

fn current_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        return "windows";
    }

    #[cfg(target_os = "macos")]
    {
        return "macos";
    }

    #[cfg(target_os = "linux")]
    {
        return "linux";
    }

    #[allow(unreachable_code)]
    "unknown"
}

pub fn desktop_platform_capabilities() -> DesktopPlatformCapabilities {
    DesktopPlatformCapabilities {
        platform: current_platform().to_string(),
        supports_auto_restart_codex_desktop: cfg!(target_os = "windows"),
        supports_auto_restart_vscode: cfg!(any(
            target_os = "windows",
            target_os = "macos",
            target_os = "linux"
        )),
        supports_resume_session_in_terminal: cfg!(target_os = "windows"),
        supports_system_tray: true,
        supports_taskbar_shortcuts: cfg!(target_os = "windows"),
        supports_dock_menu: cfg!(target_os = "macos"),
        supports_app_indicator: cfg!(target_os = "linux"),
    }
}

fn resolve_codex_cli_executable() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(path_var) = env::var_os("PATH") {
        for path in env::split_paths(&path_var) {
            #[cfg(target_os = "windows")]
            {
                candidates.push(path.join("codex.exe"));
                candidates.push(path.join("codex.cmd"));
                candidates.push(path.join("codex.bat"));
            }
            #[cfg(not(target_os = "windows"))]
            {
                candidates.push(path.join("codex"));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        candidates.push(PathBuf::from(r"C:\nvm4w\nodejs\codex.cmd"));
        candidates.push(PathBuf::from(
            r"C:\Program Files\WindowsApps\OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0\app\resources\codex.exe",
        ));
        candidates.push(PathBuf::from(
            r"C:\Program Files\WindowsApps\OpenAI.Codex_2p2nqsd0c76g0\app\resources\codex.exe",
        ));
    }

    candidates
        .into_iter()
        .find(|path| path_has_file(path))
        .ok_or_else(|| "未找到 codex 可执行文件".to_string())
}

#[cfg(target_os = "windows")]
fn escape_for_powershell_single_quotes(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn resolve_codex_desktop_executable() -> Result<PathBuf, String> {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-AppxPackage -Name 'OpenAI.Codex' | Select-Object -First 1 -ExpandProperty InstallLocation)",
        ])
        .output()
        .map_err(|e| format!("查询 Codex 桌面安装位置失败: {e}"))?;

    if output.status.success() {
        let install_location = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !install_location.is_empty() {
            let candidate = PathBuf::from(install_location)
                .join("app")
                .join("Codex.exe");
            if path_has_file(&candidate) {
                return Ok(candidate);
            }
        }
    }

    let mut candidates = vec![
        PathBuf::from(
            r"C:\Program Files\WindowsApps\OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0\app\Codex.exe",
        ),
        PathBuf::from(r"C:\Program Files\WindowsApps\OpenAI.Codex_2p2nqsd0c76g0\app\Codex.exe"),
    ];

    if let Some(program_files) = env::var_os("ProgramFiles") {
        candidates.push(
            PathBuf::from(program_files)
                .join("WindowsApps")
                .join(r"OpenAI.Codex_26.313.5234.0_x64__2p2nqsd0c76g0\app\Codex.exe"),
        );
    }

    candidates
        .into_iter()
        .find(|path| path_has_file(path))
        .ok_or_else(|| "未找到 Codex 桌面应用可执行文件".to_string())
}

#[cfg(target_os = "windows")]
pub fn restart_codex_desktop() -> Result<(), String> {
    let codex_path = resolve_codex_desktop_executable()?;
    let codex_path = escape_for_powershell_single_quotes(&codex_path.to_string_lossy());

    let restart_script = format!(
        r#"$ErrorActionPreference = 'Stop'
$targets = Get-Process -Name 'Codex' -ErrorAction SilentlyContinue | Where-Object {{ $_.Path -like '*\OpenAI.Codex_*\app\Codex.exe' }}
if ($targets) {{
  $targets | Stop-Process -Force
}}
Start-Sleep -Milliseconds 900
Start-Process -FilePath '{codex_path}'"#,
    );

    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &restart_script,
        ])
        .output()
        .map_err(|e| format!("重启 Codex 桌面应用失败: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };

    if detail.is_empty() {
        Err("重启 Codex 桌面应用失败".to_string())
    } else {
        Err(format!("重启 Codex 桌面应用失败: {detail}"))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn restart_codex_desktop() -> Result<(), String> {
    Err("当前仅支持 Windows 自动重启 Codex 桌面应用".to_string())
}

#[cfg(target_os = "windows")]
pub fn restart_vscode() -> Result<(), String> {
    let restart_script = r#"$ErrorActionPreference = 'Stop'
$candidates = @(
  "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe",
  "$env:ProgramFiles\Microsoft VS Code\Code.exe",
  "${env:ProgramFiles(x86)}\Microsoft VS Code\Code.exe"
)
$code = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $code) {
  $command = Get-Command code -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) {
    $code = $command.Source
  }
}
if (-not $code) {
  throw '未找到 VSCode 可执行文件'
}
$targets = Get-Process -Name 'Code' -ErrorAction SilentlyContinue
if ($targets) {
  $targets | Stop-Process -Force
}
Start-Sleep -Milliseconds 900
Start-Process -FilePath $code"#;

    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            restart_script,
        ])
        .output()
        .map_err(|e| format!("重启 VSCode 失败: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };

    if detail.is_empty() {
        Err("重启 VSCode 失败".to_string())
    } else {
        Err(format!("重启 VSCode 失败: {detail}"))
    }
}

#[cfg(target_os = "macos")]
pub fn restart_vscode() -> Result<(), String> {
    let _ = Command::new("osascript")
        .args(["-e", r#"tell application "Visual Studio Code" to quit"#])
        .output();

    thread::sleep(Duration::from_millis(900));

    let output = Command::new("open")
        .args(["-a", "Visual Studio Code"])
        .output()
        .map_err(|e| format!("重启 VSCode 失败: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };

    if detail.is_empty() {
        Err("重启 VSCode 失败".to_string())
    } else {
        Err(format!("重启 VSCode 失败: {detail}"))
    }
}

#[cfg(target_os = "linux")]
fn resolve_vscode_cli_executable() -> Result<PathBuf, String> {
    if let Some(path_var) = env::var_os("PATH") {
        for path in env::split_paths(&path_var) {
            for name in ["code", "code-insiders"] {
                let candidate = path.join(name);
                if path_has_file(&candidate) {
                    return Ok(candidate);
                }
            }
        }
    }

    Err("未找到 VSCode 可执行文件".to_string())
}

#[cfg(target_os = "linux")]
pub fn restart_vscode() -> Result<(), String> {
    let code_path = resolve_vscode_cli_executable()?;
    let _ = Command::new("pkill").args(["-x", "code"]).output();
    let _ = Command::new("pkill").args(["-x", "code-insiders"]).output();

    thread::sleep(Duration::from_millis(900));

    Command::new(code_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("重启 VSCode 失败: {e}"))
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn restart_vscode() -> Result<(), String> {
    Err("当前平台暂不支持自动重启 VSCode".to_string())
}

#[cfg(target_os = "windows")]
pub fn resume_session_in_terminal(session_id: String) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err("session_id 不能为空".to_string());
    }

    let codex_path = resolve_codex_cli_executable()?;
    let resume_cmd = format!(
        "\"{}\" resume {}",
        codex_path.to_string_lossy(),
        session_id.trim()
    );
    let launch_script = format!("start \"Codex Resume\" cmd.exe /K {}", resume_cmd);

    Command::new("cmd.exe")
        .arg("/C")
        .arg(launch_script)
        .spawn()
        .map_err(|e| format!("启动恢复终端失败: {e}"))?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn resume_session_in_terminal(session_id: String) -> Result<(), String> {
    let _ = session_id;
    Err("当前仅支持 Windows 一键恢复，请手动执行 codex resume <session_id>".to_string())
}
