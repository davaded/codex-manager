$ErrorActionPreference = "Stop"

$cargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
if (-not (Test-Path $cargo)) {
  throw "cargo.exe not found at $cargo"
}

& $cargo build --manifest-path src-tauri\Cargo.toml --release --bin codex-manager-cli

$cliBinary = (Resolve-Path "src-tauri\target\release\codex-manager-cli.exe").Path
$cliDefine = Join-Path (Resolve-Path "src-tauri\windows").Path "cli-path.nsh"
@(
  "!define CLIBINARYSRCPATH `"$cliBinary`""
) | Set-Content -Path $cliDefine -Encoding ASCII
