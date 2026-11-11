/**
 * Subscription-only child env for Claude Code (from OpenChamber harness).
 * Never log env values — this module only returns sanitized copies.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeConfigDir } from "./config-dir.js";

export function settingsEnv(configDir?: string): Record<string, string> {
  try {
    const settings = JSON.parse(
      readFileSync(join(claudeConfigDir(configDir), "settings.json"), "utf8"),
    );
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings?.env ?? {})) {
      if (typeof value === "string" && value.trim()) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

const GATEWAY_CREDENTIAL_KEYS = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;
const PROBE_EXCLUDED_KEYS = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
]);

export function probeSettingsEnv(configDir?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(settingsEnv(configDir))) {
    if (PROBE_EXCLUDED_KEYS.has(key) || /^ANTHROPIC_DEFAULT_\w+_MODEL$/.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function isAnthropicEndpoint(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return host === "anthropic.com" || host.endsWith(".anthropic.com");
  } catch {
    return true;
  }
}

export function gatewayProbeEnv(
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  configDir?: string,
): Record<string, string> {
  const fromSettings = settingsEnv(configDir);
  const pick = (key: string) => fromSettings[key] ?? baseEnv[key]?.trim() ?? "";
  const baseURL = pick("ANTHROPIC_BASE_URL");
  if (!baseURL || isAnthropicEndpoint(baseURL)) return {};
  const out: Record<string, string> = {
    ANTHROPIC_BASE_URL: baseURL,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
  };
  for (const key of GATEWAY_CREDENTIAL_KEYS) {
    const value = pick(key);
    if (value) out[key] = value;
  }
  return out;
}

/** Credential overrides removed so Claude Code uses its own login store. */
export const AUTH_OVERRIDE_ENV_KEYS = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
]);

/**
 * MCP tool descriptions Claude Code sends to the model, in characters. The
 * CLI cuts them at 2048 (4096 from 2.1.296), and OpenCode and OpenChamber
 * tools run longer, so their closing instructions never reached Claude. A
 * value the user set wins.
 */
export const MCP_DESCRIPTION_LIMIT = 8192;

/**
 * Build a child-process env for Claude Code subscription mode.
 * Starts from process.env (or provided base), preserves PATH, then deletes
 * credential overrides so the CLI exclusively owns authentication.
 */
export function buildClaudeCodeChildEnv(
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const env = { ...baseEnv };
  for (const key of AUTH_OVERRIDE_ENV_KEYS) {
    delete env[key];
  }
  if (!env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH?.trim()) {
    env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH = String(MCP_DESCRIPTION_LIMIT);
  }
  return env;
}
