# Project rules

Maintained fork of `openchamber/opencode-claude` (MIT; upstream archived at 1.7.0). It runs Claude Code in OpenCode and OpenChamber through the Claude Agent SDK, with the user's own Claude Code setup (settings, `CLAUDE.md`, hooks, plugins).

## Names

- npm package: `@fundryi/opencode-claude`.
- Keep the provider id `claude-code` and the picker label "Claude Code". User configs and routing rules reference them.

## Build and test

- `bun install`, `bun run build`, `bun test/run.ts`.
- Run tests without the `OPENCHAMBER_*` variables a shell inside OpenChamber inherits: `OPENCHAMBER_RUNTIME` renames the tool bridge and breaks tests. On Windows, `smoke.ts`, `cli-probes`, `config-dirs` and `setup-order` fail on Unix-path assumptions from upstream.
- The built plugin updates the Claude Agent SDK by itself at every start (`src/sdk-update.ts`), so `package.json` and `bun.lock` can change without anyone editing them. Commit those bumps with the next change.
- Build and release locally. No GitHub Actions or any other CI; do not add workflow files.
- Prefer a real check (a live OpenCode turn, title, compaction) over new test code. If a test is needed, extend an existing one.

## Code

- No new code comments. Only a one-line comment for a critical constraint no name or test can express. Leave upstream's existing comments unless asked to remove them.
- Meta requests (title, summary, generate) start Claude Code with `settingSources: []`, so Claude Code does not read `settings.json` itself. Its `env` block (endpoint, token) is passed in through `settingsEnv()` in `src/auth-env.ts`. The models probe in `src/query.ts` must not get it: a user's `ANTHROPIC_DEFAULT_*_MODEL` would hide models from the list.

## Writing

- English only. No model version numbers in docs or rules.
- Keep the README's trademark note.

## Git

- Public repo: no private data (names, emails, local paths, tokens, real exports) in commits.
- Commit author: the GitHub noreply address.
- The owner reviews every diff before a commit or push.
