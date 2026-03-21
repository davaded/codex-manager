use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use chrono::Utc;

use crate::models::{Account, AccountsStore};

const APP_IDENTIFIER: &str = "com.codex-manager.app";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CliInvocationMode {
    Auto,
    Force,
}

pub fn maybe_run_from_env(mode: CliInvocationMode) -> Result<bool> {
    let args: Vec<OsString> = env::args_os().collect();
    maybe_run(args, mode)
}

fn maybe_run(args: Vec<OsString>, mode: CliInvocationMode) -> Result<bool> {
    let args: Vec<String> = args
        .into_iter()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();

    if args.is_empty() {
        if mode == CliInvocationMode::Auto {
            return Ok(false);
        }
        print_usage();
        return Ok(true);
    }

    if mode == CliInvocationMode::Auto && should_ignore_gui_args(&args) {
        return Ok(false);
    }

    run_command(&args)?;
    Ok(true)
}

fn should_ignore_gui_args(args: &[String]) -> bool {
    matches!(args.first(), Some(arg) if arg.starts_with("-psn_"))
}

fn run_command(args: &[String]) -> Result<()> {
    let command = args.first().map(String::as_str).unwrap_or_default();

    match command {
        "help" | "--help" | "-h" => {
            print_usage();
            Ok(())
        }
        "version" | "--version" | "-V" => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "list" => list_accounts(),
        "switch" => {
            let query = args
                .iter()
                .skip(1)
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join(" ");
            switch_account(query.trim())
        }
        "internal" => run_internal_command(&args[1..]),
        _ => bail!("Unknown command '{command}'. Run 'codex-manager help'."),
    }
}

fn run_internal_command(args: &[String]) -> Result<()> {
    let command = args.first().map(String::as_str).unwrap_or_default();

    match command {
        #[cfg(target_os = "windows")]
        "add-to-path" => {
            let target = args
                .get(1)
                .context("Missing path. Usage: codex-manager internal add-to-path <dir>")?;
            windows_path::update_user_path(target, true)
        }
        #[cfg(target_os = "windows")]
        "remove-from-path" => {
            let target = args
                .get(1)
                .context("Missing path. Usage: codex-manager internal remove-from-path <dir>")?;
            windows_path::update_user_path(target, false)
        }
        _ => bail!("Unknown internal command."),
    }
}

fn print_usage() {
    println!(
        "Codex Manager CLI\n\n\
Usage:\n  codex-manager list\n  codex-manager switch <query>\n  codex-manager help\n\n\
Examples:\n  codex-manager list\n  codex-manager switch work\n  codex-manager switch dev@company.com\n  codex-manager switch 2\n"
    );
}

fn app_data_dir() -> Result<PathBuf> {
    dirs::data_dir()
        .map(|dir| dir.join(APP_IDENTIFIER))
        .context("Cannot resolve app data directory")
}

fn accounts_path() -> Result<PathBuf> {
    Ok(app_data_dir()?.join("accounts.json"))
}

fn credentials_path(account_id: &str) -> Result<PathBuf> {
    Ok(app_data_dir()?
        .join("credentials")
        .join(format!("{account_id}.json")))
}

fn auth_path() -> Result<PathBuf> {
    dirs::home_dir()
        .map(|dir| dir.join(".codex").join("auth.json"))
        .context("Cannot resolve home directory")
}

fn load_accounts_store() -> Result<AccountsStore> {
    let path = accounts_path()?;
    let content = fs::read_to_string(&path).with_context(|| {
        format!(
            "accounts.json not found. Launch Codex Manager first or import at least one account.\nExpected path: {}",
            path.display()
        )
    })?;

    serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse {}", path.display()))
}

fn write_accounts_store(store: &AccountsStore) -> Result<()> {
    let path = accounts_path()?;
    let parent = path
        .parent()
        .context("accounts.json path does not have a parent directory")?;
    fs::create_dir_all(parent)
        .with_context(|| format!("Failed to create {}", parent.display()))?;

    let content = serde_json::to_string_pretty(store).context("Failed to serialize accounts.json")?;
    fs::write(&path, format!("{content}\n"))
        .with_context(|| format!("Failed to write {}", path.display()))
}

fn sort_accounts(accounts: &[Account]) -> Vec<Account> {
    let mut sorted = accounts.to_vec();
    sorted.sort_by(|a, b| {
        if a.is_active != b.is_active {
            return b.is_active.cmp(&a.is_active);
        }

        let a_time = a
            .last_switched_at
            .as_ref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.timestamp_millis())
            .unwrap_or_default();
        let b_time = b
            .last_switched_at
            .as_ref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.timestamp_millis())
            .unwrap_or_default();

        b_time.cmp(&a_time)
    });
    sorted
}

fn identity_label(account: &Account) -> &str {
    account
        .email
        .as_deref()
        .or(account.user_id.as_deref())
        .unwrap_or(account.id.as_str())
}

fn matches_field(field: Option<&str>, query: &str, exact: bool) -> bool {
    let Some(field) = field else {
        return false;
    };

    let field = normalize(field);
    let query = normalize(query);

    if exact {
        field == query
    } else {
        field.contains(&query)
    }
}

fn exact_match(account: &Account, query: &str) -> bool {
    matches_field(Some(account.display_name.as_str()), query, true)
        || matches_field(account.email.as_deref(), query, true)
        || matches_field(account.user_id.as_deref(), query, true)
        || matches_field(Some(account.id.as_str()), query, true)
}

fn fuzzy_match(account: &Account, query: &str) -> bool {
    matches_field(Some(account.display_name.as_str()), query, false)
        || matches_field(account.email.as_deref(), query, false)
        || matches_field(account.user_id.as_deref(), query, false)
        || matches_field(Some(account.id.as_str()), query, false)
}

fn normalize(value: &str) -> String {
    value.trim().to_lowercase()
}

fn resolve_account(accounts: &[Account], query: &str) -> Result<Account> {
    let query = query.trim();
    if query.is_empty() {
        bail!("Missing account query. Usage: codex-manager switch <query>");
    }

    if let Ok(index) = query.parse::<usize>() {
        let sorted = sort_accounts(accounts);
        let account = sorted.get(index.saturating_sub(1)).cloned().with_context(|| {
            format!("No account at index {index}. Run 'codex-manager list' first.")
        })?;
        return Ok(account);
    }

    let exact: Vec<Account> = accounts
        .iter()
        .filter(|account| exact_match(account, query))
        .cloned()
        .collect();
    if exact.len() == 1 {
        return Ok(exact[0].clone());
    }
    if exact.len() > 1 {
        let matches = exact
            .iter()
            .map(identity_label)
            .collect::<Vec<_>>()
            .join(", ");
        bail!("Multiple exact matches for '{query}': {matches}");
    }

    let fuzzy: Vec<Account> = accounts
        .iter()
        .filter(|account| fuzzy_match(account, query))
        .cloned()
        .collect();
    if fuzzy.len() == 1 {
        return Ok(fuzzy[0].clone());
    }
    if fuzzy.len() > 1 {
        let matches = fuzzy
            .iter()
            .map(identity_label)
            .collect::<Vec<_>>()
            .join(", ");
        bail!("Multiple matches for '{query}': {matches}");
    }

    bail!("No account matches '{query}'. Run 'codex-manager list' first.")
}

fn list_accounts() -> Result<()> {
    let store = load_accounts_store()?;
    let sorted = sort_accounts(&store.accounts);

    if sorted.is_empty() {
        println!("No managed accounts yet.");
        return Ok(());
    }

    for (index, account) in sorted.iter().enumerate() {
        let marker = if account.is_active { "*" } else { " " };
        let last_switched = account.last_switched_at.as_deref().unwrap_or("never");
        println!(
            "{marker} {}. {} ({})  last switch: {}",
            index + 1,
            account.display_name,
            identity_label(account),
            last_switched
        );
    }

    Ok(())
}

fn switch_account(query: &str) -> Result<()> {
    let mut store = load_accounts_store()?;
    if store.accounts.is_empty() {
        bail!("No managed accounts found. Import or add an account first.");
    }

    let target = resolve_account(&store.accounts, query)?;
    if target.is_active {
        println!("Already using {}.", target.display_name);
        return Ok(());
    }

    let credential_path = credentials_path(&target.id)?;
    let auth_content = fs::read_to_string(&credential_path).with_context(|| {
        format!(
            "Credential not found for '{}' at {}",
            target.display_name,
            credential_path.display()
        )
    })?;

    let auth_path = auth_path()?;
    let auth_parent = auth_path
        .parent()
        .context("auth.json path does not have a parent directory")?;
    fs::create_dir_all(auth_parent)
        .with_context(|| format!("Failed to create {}", auth_parent.display()))?;
    fs::write(&auth_path, auth_content)
        .with_context(|| format!("Failed to write {}", auth_path.display()))?;

    let now = Utc::now().to_rfc3339();
    for account in &mut store.accounts {
        account.is_active = account.id == target.id;
        if account.id == target.id {
            account.last_switched_at = Some(now.clone());
        }
    }
    write_accounts_store(&store)?;

    println!(
        "Switched to {} ({}).",
        target.display_name,
        identity_label(&target)
    );
    println!("If Codex CLI or the desktop app is running, restart it to pick up the new auth.");

    Ok(())
}

pub fn macos_shell_command_target() -> Result<PathBuf> {
    resolve_current_exe().map(|path| {
        path.parent()
            .and_then(Path::parent)
            .map(|contents| contents.join("MacOS").join("codex-manager"))
            .unwrap_or(path)
    })
}

fn resolve_current_exe() -> Result<PathBuf> {
    env::current_exe().context("Cannot resolve current executable path")
}

#[cfg(target_os = "windows")]
mod windows_path {
    use std::{
        ffi::OsStr,
        iter,
        os::windows::ffi::OsStrExt,
        path::PathBuf,
    };

    use anyhow::{Context, Result};
    use windows_sys::Win32::{
        UI::WindowsAndMessaging::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        },
    };
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE},
        RegKey,
    };

    pub fn update_user_path(target: &str, present: bool) -> Result<()> {
        let target = normalize(target)?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let environment = hkcu
            .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
            .or_else(|_| hkcu.create_subkey("Environment").map(|(key, _)| key))
            .context("Failed to open HKCU\\Environment")?;

        let raw: String = environment.get_value("Path").unwrap_or_default();
        let mut parts: Vec<String> = raw
            .split(';')
            .filter_map(|item| {
                let trimmed = item.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
            .collect();

        parts.retain(|item| !same_path(item, &target));
        if present {
            parts.push(target.clone());
        }

        environment
            .set_value("Path", &parts.join(";"))
            .context("Failed to update user PATH")?;
        broadcast_environment_change();

        Ok(())
    }

    fn normalize(value: &str) -> Result<String> {
        let path = PathBuf::from(value);
        let absolute = if path.is_absolute() {
            path
        } else {
            std::env::current_dir()
                .context("Cannot resolve current directory")?
                .join(path)
        };

        Ok(absolute
            .components()
            .collect::<PathBuf>()
            .to_string_lossy()
            .trim_end_matches(['\\', '/'])
            .to_string())
    }

    fn same_path(left: &str, right: &str) -> bool {
        normalize_existing(left) == normalize_existing(right)
    }

    fn normalize_existing(value: &str) -> String {
        value
            .trim()
            .trim_end_matches(['\\', '/'])
            .to_ascii_lowercase()
    }

    fn broadcast_environment_change() {
        let param: Vec<u16> = OsStr::new("Environment")
            .encode_wide()
            .chain(iter::once(0))
            .collect();

        unsafe {
            let _ = SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                param.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                5000,
                std::ptr::null_mut(),
            );
        }
    }
}
