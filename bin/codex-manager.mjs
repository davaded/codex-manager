#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const APP_IDENTIFIER = "com.codex-manager.app";

function getAppDataDir() {
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      APP_IDENTIFIER,
    );
  }

  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      APP_IDENTIFIER,
    );
  }

  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    APP_IDENTIFIER,
  );
}

function getAccountsPath() {
  return path.join(getAppDataDir(), "accounts.json");
}

function getCredentialsPath(accountId) {
  return path.join(getAppDataDir(), "credentials", `${accountId}.json`);
}

function getAuthPath() {
  return path.join(os.homedir(), ".codex", "auth.json");
}

function identityLabel(account) {
  return account.email ?? account.userId ?? account.id;
}

async function readJson(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadAccountsStore() {
  try {
    return await readJson(getAccountsPath());
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `accounts.json not found. Launch Codex Manager first or import at least one account.\nExpected path: ${getAccountsPath()}`,
      );
    }
    throw error;
  }
}

function sortAccounts(accounts) {
  return [...accounts].sort((a, b) => {
    if (a.isActive) return -1;
    if (b.isActive) return 1;
    const da = a.lastSwitchedAt ? new Date(a.lastSwitchedAt).getTime() : 0;
    const db = b.lastSwitchedAt ? new Date(b.lastSwitchedAt).getTime() : 0;
    return db - da;
  });
}

function printUsage() {
  console.log(`Codex Manager CLI

Usage:
  codex-manager list
  codex-manager switch <query>
  codex-manager help

Examples:
  codex-manager list
  codex-manager switch work
  codex-manager switch dev@company.com
  codex-manager switch 2
`);
}

function normalize(value) {
  return value.trim().toLowerCase();
}

function exactMatch(account, query) {
  const value = normalize(query);
  return [
    account.displayName,
    account.email,
    account.userId,
    account.id,
  ].some((item) => typeof item === "string" && normalize(item) === value);
}

function fuzzyMatch(account, query) {
  const value = normalize(query);
  return [
    account.displayName,
    account.email,
    account.userId,
    account.id,
  ].some((item) => typeof item === "string" && normalize(item).includes(value));
}

function resolveAccount(accounts, query) {
  const sorted = sortAccounts(accounts);
  const index = Number.parseInt(query, 10);
  if (!Number.isNaN(index) && `${index}` === query.trim()) {
    const account = sorted[index - 1];
    if (!account) {
      throw new Error(`No account at index ${index}. Run 'codex-manager list' first.`);
    }
    return account;
  }

  const exact = accounts.filter((account) => exactMatch(account, query));
  if (exact.length === 1) {
    return exact[0];
  }
  if (exact.length > 1) {
    throw new Error(
      `Multiple exact matches for '${query}': ${exact.map((account) => identityLabel(account)).join(", ")}`,
    );
  }

  const fuzzy = accounts.filter((account) => fuzzyMatch(account, query));
  if (fuzzy.length === 1) {
    return fuzzy[0];
  }
  if (fuzzy.length > 1) {
    throw new Error(
      `Multiple matches for '${query}': ${fuzzy.map((account) => identityLabel(account)).join(", ")}`,
    );
  }

  throw new Error(`No account matches '${query}'. Run 'codex-manager list' first.`);
}

async function listAccounts() {
  const store = await loadAccountsStore();
  const sorted = sortAccounts(store.accounts ?? []);

  if (sorted.length === 0) {
    console.log("No managed accounts yet.");
    return;
  }

  for (const [index, account] of sorted.entries()) {
    const marker = account.isActive ? "*" : " ";
    const lastSwitched = account.lastSwitchedAt ?? "never";
    console.log(
      `${marker} ${index + 1}. ${account.displayName} (${identityLabel(account)})  last switch: ${lastSwitched}`,
    );
  }
}

async function switchAccount(query) {
  if (!query) {
    throw new Error("Missing account query. Usage: codex-manager switch <query>");
  }

  const store = await loadAccountsStore();
  const accounts = Array.isArray(store.accounts) ? store.accounts : [];
  if (accounts.length === 0) {
    throw new Error("No managed accounts found. Import or add an account first.");
  }

  const target = resolveAccount(accounts, query);
  if (target.isActive) {
    console.log(`Already using ${target.displayName}.`);
    return;
  }

  const credentialPath = getCredentialsPath(target.id);
  const authContent = await fs.readFile(credentialPath, "utf8").catch(() => {
    throw new Error(`Credential not found for '${target.displayName}' at ${credentialPath}`);
  });

  await fs.mkdir(path.dirname(getAuthPath()), { recursive: true });
  await fs.writeFile(getAuthPath(), authContent, "utf8");

  const now = new Date().toISOString();
  const nextAccounts = accounts.map((account) => ({
    ...account,
    isActive: account.id === target.id,
    lastSwitchedAt: account.id === target.id ? now : account.lastSwitchedAt,
  }));

  await writeJson(getAccountsPath(), {
    version: store.version ?? "1.0",
    accounts: nextAccounts,
  });

  console.log(`Switched to ${target.displayName} (${identityLabel(target)}).`);
  console.log("If Codex CLI or the desktop app is running, restart it to pick up the new auth.");
}

async function main() {
  const [, , command, ...rest] = process.argv;

  try {
    switch (command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        printUsage();
        break;
      case "list":
        await listAccounts();
        break;
      case "switch":
        await switchAccount(rest.join(" ").trim());
        break;
      default:
        throw new Error(`Unknown command '${command}'. Run 'codex-manager help'.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();
