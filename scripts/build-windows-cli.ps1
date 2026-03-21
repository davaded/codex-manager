$ErrorActionPreference = "Stop"

$cargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
if (-not (Test-Path $cargo)) {
  throw "cargo.exe not found at $cargo"
}

& $cargo build --manifest-path src-tauri\Cargo.toml --release --bin codex-manager-cli
