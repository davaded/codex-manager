use crate::models::AppSettings;

#[cfg(any(target_os = "macos", test))]
use std::collections::HashMap;

fn env_proxy_url() -> Option<String> {
    [
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ]
    .iter()
    .filter_map(|key| std::env::var(key).ok())
    .map(|value| value.trim().to_string())
    .find(|value| !value.is_empty())
}

fn add_default_scheme(value: &str, scheme: &str) -> String {
    if value.contains("://") {
        value.to_string()
    } else {
        format!("{scheme}://{value}")
    }
}

fn parse_proxy_server_entry(proxy_server: &str) -> Option<String> {
    let trimmed = proxy_server.trim();
    if trimmed.is_empty() {
        return None;
    }

    if !trimmed.contains(';') && !trimmed.contains('=') {
        return Some(add_default_scheme(trimmed, "http"));
    }

    let mut http_proxy = None;
    let mut socks_proxy = None;

    for part in trimmed
        .split(';')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        let Some((raw_kind, raw_value)) = part.split_once('=') else {
            continue;
        };
        let kind = raw_kind.trim().to_ascii_lowercase();
        let value = raw_value.trim();
        if value.is_empty() {
            continue;
        }

        match kind.as_str() {
            "https" => return Some(add_default_scheme(value, "http")),
            "http" => http_proxy = Some(add_default_scheme(value, "http")),
            "socks" | "socks5" => socks_proxy = Some(add_default_scheme(value, "socks5")),
            _ => {}
        }
    }

    http_proxy.or(socks_proxy)
}

#[cfg(target_os = "windows")]
fn windows_system_proxy_url() -> Option<String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let settings = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    let enabled = settings.get_value::<u32, _>("ProxyEnable").unwrap_or(0);
    if enabled == 0 {
        return None;
    }

    let proxy_server = settings.get_value::<String, _>("ProxyServer").ok()?;
    parse_proxy_server_entry(&proxy_server)
}

#[cfg(not(target_os = "windows"))]
fn windows_system_proxy_url() -> Option<String> {
    None
}

#[cfg(any(target_os = "macos", test))]
fn parse_scutil_proxy_output(output: &str) -> Option<String> {
    let mut values = HashMap::new();

    for line in output.lines() {
        let Some((raw_key, raw_value)) = line.split_once(':') else {
            continue;
        };
        let key = raw_key.trim();
        let value = raw_value.trim().trim_matches('"').trim_matches('\'');
        if !key.is_empty() && !value.is_empty() {
            values.insert(key.to_string(), value.to_string());
        }
    }

    fn enabled(values: &HashMap<String, String>, key: &str) -> bool {
        matches!(
            values.get(key).map(|value| value.as_str()),
            Some("1") | Some("true") | Some("TRUE")
        )
    }

    fn proxy_url(
        values: &HashMap<String, String>,
        enable_key: &str,
        host_key: &str,
        port_key: &str,
        scheme: &str,
    ) -> Option<String> {
        if !enabled(values, enable_key) {
            return None;
        }
        let host = values.get(host_key)?.trim();
        let port = values.get(port_key)?.trim();
        if host.is_empty() || port.is_empty() {
            return None;
        }
        let normalized_host = if host.contains(':') && !host.starts_with('[') {
            format!("[{host}]")
        } else {
            host.to_string()
        };
        Some(format!("{scheme}://{normalized_host}:{port}"))
    }

    proxy_url(&values, "HTTPSEnable", "HTTPSProxy", "HTTPSPort", "http")
        .or_else(|| proxy_url(&values, "HTTPEnable", "HTTPProxy", "HTTPPort", "http"))
        .or_else(|| proxy_url(&values, "SOCKSEnable", "SOCKSProxy", "SOCKSPort", "socks5"))
}

#[cfg(target_os = "macos")]
fn macos_system_proxy_url() -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/scutil")
        .arg("--proxy")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = std::str::from_utf8(&output.stdout).ok()?;
    parse_scutil_proxy_output(stdout)
}

#[cfg(not(target_os = "macos"))]
fn macos_system_proxy_url() -> Option<String> {
    None
}

fn configured_proxy_url(settings: &AppSettings) -> Option<String> {
    let explicit = settings.proxy_url.trim();
    if !explicit.is_empty() {
        return Some(explicit.to_string());
    }

    env_proxy_url()
        .or_else(macos_system_proxy_url)
        .or_else(windows_system_proxy_url)
}

pub fn build_http_client(
    settings: &AppSettings,
    user_agent: &str,
    timeout: std::time::Duration,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(timeout);

    if let Some(proxy_url) = configured_proxy_url(settings) {
        let proxy = reqwest::Proxy::all(&proxy_url)
            .map_err(|e| format!("Invalid proxy URL {proxy_url}: {e}"))?;
        builder = builder.proxy(proxy);
    }

    builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{parse_proxy_server_entry, parse_scutil_proxy_output};

    #[test]
    fn parses_single_proxy_server() {
        assert_eq!(
            parse_proxy_server_entry("127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
    }

    #[test]
    fn prefers_https_proxy_server_entry() {
        assert_eq!(
            parse_proxy_server_entry("http=127.0.0.1:7890;https=127.0.0.1:7891").as_deref(),
            Some("http://127.0.0.1:7891")
        );
    }

    #[test]
    fn parses_socks_proxy_server_entry() {
        assert_eq!(
            parse_proxy_server_entry("socks=127.0.0.1:1080").as_deref(),
            Some("socks5://127.0.0.1:1080")
        );
    }

    #[test]
    fn parses_macos_https_system_proxy() {
        let output = r#"
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7891
  HTTPSProxy : 127.0.0.1
}
"#;

        assert_eq!(
            parse_scutil_proxy_output(output).as_deref(),
            Some("http://127.0.0.1:7891")
        );
    }

    #[test]
    fn parses_macos_http_system_proxy() {
        let output = r#"
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 0
}
"#;

        assert_eq!(
            parse_scutil_proxy_output(output).as_deref(),
            Some("http://127.0.0.1:7890")
        );
    }

    #[test]
    fn parses_macos_socks_system_proxy() {
        let output = r#"
<dictionary> {
  HTTPEnable : 0
  HTTPSEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 1080
  SOCKSProxy : 127.0.0.1
}
"#;

        assert_eq!(
            parse_scutil_proxy_output(output).as_deref(),
            Some("socks5://127.0.0.1:1080")
        );
    }
}
