#!/usr/bin/env node
// Pre-deploy sanity check: every api/*.js must start with valid JS,
// never with HTML (the exact failure mode from the 2026-04-20 incident).
//
// Runs automatically on `vercel-build`. Fails the deploy if any file is broken.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const API_DIR = fileURLToPath(new URL("../api/", import.meta.url));
const errors = [];

function checkFile(path) {
  const src = readFileSync(path, "utf8");
  const firstLine = src.split("\n")[0].trim();

  // Catch the exact incident pattern: HTML where JS should be.
  if (firstLine.startsWith("<") || firstLine.toLowerCase().includes("<!doctype")) {
    errors.push(`${path}: starts with HTML, not JS. First line: ${firstLine.slice(0, 80)}`);
    return;
  }

  // Must have an export or module.exports to be a valid serverless function.
  if (!/export\s+default|module\.exports|exports\./m.test(src)) {
    errors.push(`${path}: no export found — not a valid Vercel function`);
    return;
  }

  // Syntax check via node --check (handles both ESM and CJS).
  try {
    execSync(`node --check "${path}"`, { stdio: "pipe" });
  } catch (err) {
    const msg = (err.stderr || err.stdout || err.message).toString().split("\n").slice(0, 3).join(" | ");
    errors.push(`${path}: syntax error — ${msg}`);
  }
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!name.endsWith(".js")) continue;
    checkFile(full);
  }
}

walk(API_DIR);

if (errors.length) {
  console.error("\n❌ API pre-deploy check FAILED:\n");
  for (const e of errors) console.error("  - " + e);
  console.error("\nDeploy aborted. Fix the above before pushing.\n");
  process.exit(1);
}

console.log(`✅ API pre-deploy check passed (${API_DIR})`);
