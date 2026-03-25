#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function spawnCommand(command, args) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

function runRustCli() {
  const args = process.argv.slice(2);
  if (process.env.CODEX_MANAGER_CLI_BIN) {
    spawnCommand(process.env.CODEX_MANAGER_CLI_BIN, args);
    return;
  }

  const cargoArgs = [
    "run",
    "--manifest-path",
    path.join("src-tauri", "Cargo.toml"),
    "--bin",
    "codex-manager-cli",
    "--",
    ...args,
  ];

  spawnCommand("cargo", cargoArgs);
}

runRustCli();
