# Claude Code reference for HARNEST

| | |
|---|---|
| Verified on | 2026-10-04 |
| Docs checked | https://code.claude.com/docs/en/ (all pages via `llms.txt`), changelog up to **v2.1.289** (Oct 3, 2026) |
| CLI checked | installed `2.1.281 (Claude Code)`: `claude --version` plus every `--help` page. No sessions were started |
| Source tags | **D:page** = `https://code.claude.com/docs/en/<page>` · **H** = installed `claude … --help` · **C:x.y.z** = changelog entry |

Rules for lesson writers:
- This file is the single source of truth. Anything marked **UNVERIFIED** is illustrative only, never an exact string the player must type or recognise.
- The game models **current docs (v2.1.289)**. "v2.1.x+" marks behaviour that needs at least that version.
- Strings in `code` are exact. Keep their capitalisation and punctuation.

---

## Level 1: First steps

### 1.1 Install, log in, start

| Item | Exact syntax | What the user sees | Gotchas | Src |
|---|---|---|---|---|
| Install (native, recommended) | `curl -fsSL https://claude.ai/install.sh \| bash` (macOS/Linux/WSL) · `irm https://claude.ai/install.ps1 \| iex` (Windows PowerShell) | Installs `claude`. Native installs auto-update | Also `brew install --cask claude-code` and `winget install Anthropic.ClaudeCode` (no auto-update). npm is still documented (Node 22+, never `sudo`) | D:quickstart, D:setup |
| Check | `claude --version` | A version number followed by `(Claude Code)`, e.g. `2.1.281 (Claude Code)` | "not found" means the install folder isn't on PATH | D:quickstart, H |
| First run | `claude` | Asks you to log in the first time. For a Claude subscription or Console account you sign in in the browser, and the credentials are stored. `/login` switches account, `/logout` signs out | With `ANTHROPIC_API_KEY` set, it asks you to approve the key instead | D:quickstart |
| Start in a project | `cd /path/to/project` then `claude` | Interactive session. The version, model and working directory appear above the prompt | A never-trusted folder shows a **workspace trust dialog** first (wording **UNVERIFIED**) | D:quickstart, D:security |
| Start with a task | `claude "fix the build error"` | The interactive session opens and sends that prompt | Unlike `claude -p "…"`, which answers once and exits | D:quickstart |

### 1.2 Talking to Claude
- Plain language works: `what does this project do?`, `where is the main entry point?`, `add a hello world function to the main file`. "You don't have to manually add context." Be specific: "fix the login bug where users see a blank screen after entering wrong credentials" beats "fix the bug". (D:quickstart)
- If you type and press `Enter` while Claude is working, the message is **queued**, not an interruption. Messages Claude hasn't started on yet show in gray. (D:interactive-mode)
- New line in a prompt: `\` + `Enter` or `Ctrl+J` (any terminal). `Shift+Enter` works natively in iTerm2, WezTerm, Ghostty, Kitty, Warp, Apple Terminal and Windows Terminal; `/terminal-setup` adds it elsewhere. (D:interactive-mode)

### 1.3 /help and /init

| Command | What it does | Gotchas | Src |
|---|---|---|---|
| `/help` | "Show help and available commands" | Typing `/` opens the menu of commands **and skills** (type to filter, `Tab` completes). `?` on an empty prompt toggles the shortcut panel | D:commands, D:interactive-mode |
| `/init` | "Initialize project with a `CLAUDE.md` guide". Claude analyses the code and writes the build and test commands and conventions it finds. If CLAUDE.md exists, it "suggests improvements rather than overwriting it" | `CLAUDE_CODE_NEW_INIT=1` gives an interactive flow that also offers skills, hooks and `CLAUDE.local.md`. Afterwards, add what Claude can't discover and keep it under about 200 lines | D:commands, D:memory |

### 1.4 Permission prompts
- In Manual mode, reads inside the working folders run without asking. **Bash** asks, except built-in read-only commands. **File edits** ask. **WebFetch** asks, except preapproved docs domains. **WebSearch** asks. (D:permissions)
- **Big change:** from v2.1.283, interactive sessions **start in auto mode**. A classifier reviews actions, and most edits and commands run without asking. Prompts are normal in **Manual** mode: press `Shift+Tab` until `⏸ manual mode on`, or start `claude --permission-mode manual`. On the installed 2.1.281, auto is the default only on Pro/Max/Team. (D:permission-modes, D:quickstart)
- **Exact Bash prompt** (official screenshot, Manual mode). The dashed lines are full-width rules, and `❯` is the cursor:

```
Bash command
Tip: auto mode handles these prompts for you — choose "switch to auto mode" below
Run the test suite
- - - - - - - - - - - - - - - - - - - - - - - - - - - -
npm test
- - - - - - - - - - - - - - - - - - - - - - - - - - - -
This command requires approval

Do you want to proceed?
❯ 1. Yes
  2. Yes, and don't ask again for: npm test *
  3. Yes, and switch to auto mode · auto mode handles these prompts for you
  4. No

Esc to cancel · Tab to amend
```

- Option 2 saves an allow rule to `.claude/settings.local.json` at the repo root. Bash commands and WebFetch domains are remembered permanently for that repository. Option 3 isn't on every prompt. `Esc` = **No**. `Tab` on Yes or No adds a comment. (D:permissions, D:interactive-mode)
- File edits: a "this session" approval lasts until the session ends and isn't saved. `Shift+Tab` on a file prompt picks it. The edit dialog's exact wording is **UNVERIFIED**. Some prompts offer only a one-time Yes. (D:permissions, D:interactive-mode)

### 1.5 Leaving

| Way | Effect | Src |
|---|---|---|
| `/exit` (alias `/quit`) | Exits the CLI. In an attached background session it detaches | D:commands |
| `Ctrl+D` | The first press shows a hint, and a second within 800 ms exits (with text in the prompt it deletes forward instead) | D:interactive-mode |
| `Ctrl+C` | Interrupts work. When idle, the first press clears the input and the second exits | D:interactive-mode |
| Background work running | A `Background work is running` dialog offers `Move to background and exit` | D:agent-view |

---

## Level 2: Context and memory

### 2.1 Feeding context

| Item | Syntax | What it does | Gotchas | Src |
|---|---|---|---|---|
| File mention | `Explain the logic in @src/utils/auth.js` | Puts the file's **full content** into the conversation. `@src/components` (a folder) gives a listing. `@` opens path autocomplete | It also loads CLAUDE.md files from that file's folder and its parents. Several mentions per message are fine | D:common-workflows |
| Shell mode | `! npm test` | Runs the command directly (no approval) with live output, and adds the command and output to context. **v2.1.186+: Claude then responds automatically** | `"respondToBashCommands": false` restores silent mode. Leave with `Esc`/`Backspace` on an empty prompt. Runs outside the sandbox | D:interactive-mode |
| Image | `Ctrl+V` (`Alt+V` on Windows) | Inserts an `[Image #N]` chip | | D:interactive-mode |

### 2.2 The context window

| Item | Syntax | What it does | Gotchas | Src |
|---|---|---|---|---|
| Clear | `/clear [name]` | Starts a new conversation with empty context | Use it between unrelated tasks. The old conversation stays in `/resume` | D:commands |
| Compact | `/compact [instructions]` | Summarises the conversation to free space, e.g. `/compact focus on the auth bug fix` | Completion message **UNVERIFIED** | D:commands |
| Auto-compaction | automatic | Runs like `/compact` as the window nears its limit | `/autocompact 500k` sets the trigger. Afterwards, root CLAUDE.md, unscoped rules, auto memory and the plan are re-injected, and up to 5 recent files are re-read. Nested CLAUDE.md files and `paths:` rules return only when matching files are read | D:context-window |
| Inspect | `/context [all]` | "Visualize current context usage as a colored grid" with optimisation suggestions | Confirmed categories: `Free space`, `Messages`, `MCP tools`, plus an MCP server instructions row (v2.1.283+). The rest is **UNVERIFIED** | D:commands, C:2.1.283 |

Judgement (D:best-practices): run `/clear` in a "kitchen sink" session. After two failed corrections, `/clear` and write a better first prompt. Hand big investigations to a subagent.

### 2.3 CLAUDE.md layers

| Layer | Path | Shared with |
|---|---|---|
| Managed policy | `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS) · `/etc/claude-code/CLAUDE.md` (Linux/WSL) · `C:\Program Files\ClaudeCode\CLAUDE.md` (Windows) | Organisation |
| User | `~/.claude/CLAUDE.md` | You, all projects |
| Project | `./CLAUDE.md` or `./.claude/CLAUDE.md` | Team (git) |
| Local | `./CLAUDE.local.md` (gitignore it) | You, this project |

- Files are **concatenated, not overridden**. Files from the filesystem root down to the working folder load at launch, so the closest file comes last. Subfolder CLAUDE.md files load when Claude reads files there. (D:memory)
- Imports: `@path/to/file` inside a CLAUDE.md, relative to that file, up to **four hops** deep. Path-scoped rules go in `.claude/rules/*.md` with `paths:` frontmatter. (D:memory)
- `AGENTS.md` is read when no CLAUDE.md exists (v2.1.277+). The session shows `no CLAUDE.md found; AGENTS.md loaded: <path>`. (D:memory)
- `/memory` = "Edit `CLAUDE.md` files, enable or disable auto memory, and view auto memory entries". (D:commands)
- **The `#` memory shortcut was removed** (v2.0.70). Say "add this to CLAUDE.md", or edit the file through `/memory`. (C:2.0.70)

### 2.4 Auto memory
- On by default. Claude keeps its own notes in `~/.claude/projects/<project>/memory/MEMORY.md` (the first 200 lines or 25KB load each session, shared by every worktree of a repo). The UI shows "Saved 2 memories" and "Recalled 2 memories". "remember that …" goes to auto memory, not CLAUDE.md. Toggle it in `/memory` (`autoMemoryEnabled`). (D:memory)

### 2.5 Resuming and naming

| Syntax | Effect | Src |
|---|---|---|
| `claude -c` / `--continue` | Reopens the most recent conversation in this folder | D:sessions, H |
| `claude -r` / `--resume [id-or-name]` | Opens the session picker, or resumes directly | D:sessions, H |
| `/resume [session]` | The same inside a session. Background sessions are marked `bg` | D:commands |
| `claude -n auth-refactor` / `/rename [name]` | Names the session, "shown in the prompt box, /resume picker, and terminal title". `Ctrl+R` renames in the picker | H, D:sessions |
| `/branch [name]` | Forks the conversation here. The original stays in `/resume`. CLI form: `claude --continue --fork-session` | D:commands, D:checkpointing |

Gotchas: `-p` sessions are left out of the picker and `--continue` (resume them by ID). Resuming restores the session's permission mode. (D:sessions)

---

## Level 3: Control

### 3.1 Permission modes

| Mode (config value) | Status line | Runs without asking | For |
|---|---|---|---|
| `default`, labelled **Manual** (alias `manual`, v2.1.200+) | `⏸ manual mode on` | Reads only | Reviewing every action |
| `acceptEdits` | `⏵⏵ accept edits on` | Reads, file edits, and `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp`, `sed` inside the working folders | Iterating on code you review after |
| `plan` | `⏸ plan mode on` | Reads (plus classifier-approved commands). No source edits | Exploring first |
| `auto` | `⏵⏵ auto mode on` | Everything, checked by a background classifier | Long tasks |
| `dontAsk` | `⏵⏵ don't ask on` | Pre-approved tools only. Everything else is **denied** | Locked-down CI |
| `bypassPermissions` | `⏵⏵ bypass permissions on` | Everything | Isolated containers and VMs only |

- **`Shift+Tab`** goes from auto to Manual, then `acceptEdits` → `plan` → (`bypassPermissions` if enabled) → `auto`. The official clip: `auto mode on` → `manual mode on` → `accept edits on` → `plan mode on` → `auto mode on`. (D:permission-modes)
- **Flag:** `--permission-mode <mode>`. The installed help lists `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. **Setting:** `"permissions": {"defaultMode": "…"}`. `"auto"` is ignored in `.claude/settings.json` and `.claude/settings.local.json`; put it in `~/.claude/settings.json`. (H, D:permission-modes)
- **Start mode:** the flag wins, then `defaultMode`, then the built-in default: `auto` for interactive sessions (v2.1.283+, or Manual if auto is unavailable). `-p` and the SDK use `default` unless they're on a third-party provider or telemetry is off (then `auto`, v2.1.285+). (D:permission-modes)
- **Auto mode:** a separate classifier reviews actions, and `ask` rules still prompt. It needs a supporting model (not Haiku), and admins can disable it. The docs warn it "does not guarantee safety". (D:permission-modes)

### 3.2 Plan mode
- **Enter:** `Shift+Tab` until `⏸ plan mode on`, `/plan fix the auth bug`, or `claude --permission-mode plan`. Pressing `Shift+Tab` again leaves without approving. Claude reads and plans; edits stay blocked until you approve. (D:permission-modes)
- **Approval options (exact):** **Yes, and use auto mode** (reads **Yes, auto-accept edits** when auto is unavailable, or **Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session** when bypass is enabled) · **Yes, manually approve edits** · **No, keep planning**. `Ctrl+G` edits the plan in your editor (footer: "ctrl+g to edit in <editor>"). (D:permission-modes)
- Recommended workflow: **Explore → Plan → Implement → Commit**. (D:best-practices)

### 3.3 Interrupting
- `Esc` stops the current response or tool call. Claude keeps the work done so far, and queued messages go next. On a permission prompt `Esc` = No; in a dialog it closes the dialog. (D:interactive-mode)
- `Esc` `Esc`: with text, it clears the draft (`Up` recalls it); with an empty prompt, it opens the rewind menu. (D:interactive-mode)

### 3.4 Rewind (checkpoints)
- Open with `/rewind` (aliases `/checkpoint`, `/undo`) or `Esc` `Esc` on an empty prompt. Every prompt that starts a turn creates a checkpoint, and checkpoints survive resume. (D:checkpointing)
- **Menu (exact):** **Restore code and conversation** · **Restore conversation** · **Restore code** · **Summarize from here** · **Summarize up to here** · **Never mind**. The code options appear only when there are tracked edits. (D:checkpointing)
- **Limits:** changes made by **Bash commands** aren't tracked, nor are external edits, and subagent edits aren't restored. "Not a replacement for version control". (D:checkpointing)

### 3.5 /permissions and rules
- `/permissions` opens a dialog to view rules by scope, add or remove allow, ask and deny rules, manage working folders, and review auto-mode denials. (D:commands)
- Rules live in `"permissions": {"allow": [], "ask": [], "deny": []}` in `~/.claude/settings.json`, `.claude/settings.json` (team) or `.claude/settings.local.json` (personal; written by "don't ask again"). Lists merge across files. (D:settings, D:permissions)
- Order: "deny, then ask, then allow. The first match in that order determines the outcome." Deny rules apply in every mode. (D:permissions)

| Rule | Matches |
|---|---|
| `Bash` / `Bash(*)` | All Bash commands |
| `Bash(npm run *)` | Commands starting `npm run `. The space before `*` matters: `Bash(git diff*)` also matches `git diff-index` |
| `Read(./.env)` | Reading `.env` (deny it to protect secrets) |
| `Edit(/src/**/*.ts)` | A leading `/` is relative to the settings source (the project root for project settings). `//` = absolute path |
| `WebFetch(domain:example.com)` | Fetches to that domain |
| `mcp__puppeteer__*` | All tools of the `puppeteer` MCP server |

```json
{ "permissions": { "allow": ["Bash(npm run *)", "Bash(git commit *)"], "deny": ["Bash(git push *)"] } }
```
(D:permissions, D:settings)

### 3.6 Why not to skip permissions
- `--dangerously-skip-permissions` = `--permission-mode bypassPermissions`. The help says: "Recommended only for sandboxes with no internet access." `--allow-dangerously-skip-permissions` only adds bypass to the `Shift+Tab` cycle. (H)
- In bypass, allow rules do nothing because everything runs. Deny rules still block, `ask` rules still prompt, and `rm -rf ~`-style critical-path removals are never auto-approved. Safer choices are auto mode or narrow allow rules. (D:permission-modes)

### 3.7 Model and effort
- `/model [model]` opens a picker and **saves the choice as the default** for new sessions; press `s` to switch for this session only, and use the arrows to adjust effort. Also `--model <alias>` and `Option+P`/`Alt+P`. (D:commands, D:interactive-mode)
- **Aliases:** `default`, `best`, `fable`, `opus`, `sonnet`, `haiku`, `sonnet[1m]`, `opus[1m]`, `opusplan`. On the Anthropic API, `opus` = Opus 5.5 and `sonnet` = Sonnet 5.5 (v2.1.284+). `fable` is for the hardest, longest tasks and can bill usage credits after a consent prompt. `best` = Fable if available, otherwise Opus. `opusplan` = Opus while planning, Sonnet to execute. `default` = Opus 5.5 on paid plans and the API. (D:model-config, H)
- **Effort:** `/effort low|medium|high|xhigh|max|auto` or `--effort`. Opus 5.5 and Sonnet 5.5 default to `medium`. Use `ultrathink` in a prompt for one deep turn. "think hard" is **ordinary text** now. `Option+T`/`Alt+T` toggles thinking (no effect on Opus 5.5, Sonnet 5.5 or Fable). (D:model-config, D:interactive-mode)

### 3.8 Give Claude a way to verify
- Best practice #1: "Give Claude a check it can run: tests, a build, a screenshot to compare." Without a check, you become the verification loop. Example prompt: "…example test cases: … run the tests after implementing". (D:best-practices)
- Helpers: `/verify` (builds, runs and observes your app), `/code-review` (alias `/review`), `/security-review`, `/diff`. "If you can't verify it, don't ship it." (D:commands, D:best-practices)

---

## Level 4: Extending

### 4.1 MCP servers

| Item | Exact syntax | Notes |
|---|---|---|
| Remote HTTP (recommended) | `claude mcp add --transport http notion https://mcp.notion.com/mcp` | Auth: `--header "Authorization: Bearer your-token"` |
| SSE (**deprecated**) | `claude mcp add --transport sse <name> <url>` | `--transport http` falls back to SSE on its own (v2.1.265+) |
| Local stdio | `claude mcp add --env API_KEY=xxx --transport stdio myserver -- npx -y some-server` | `--` separates Claude's options from the server command. Default transport: stdio |
| JSON | `claude mcp add-json <name> '<json>'` | The only way to add WebSocket servers |
| Manage | `claude mcp list` / `get <name>` / `remove <name>` / `login <name>` | A successful add prints `Added ...`. Statuses: `✔ Connected`, `! Needs authentication`, `✘ Failed to connect`, ``⏸ Pending approval (run `claude` to approve)`` |

Sources: D:mcp, H.

| Scope (`--scope`, `-s`) | Loads in | Stored in |
|---|---|---|
| `local` (default) | This project, just you | `~/.claude.json` |
| `project` | This project, the team (commit it) | `.mcp.json` at the project root |
| `user` | All your projects | `~/.claude.json` |

- When the same name is defined twice, precedence is local > project > user > plugin > claude.ai connectors. `.mcp.json` looks like `{"mcpServers": {"name": {"type": "http", "url": "…"}}}`, supports `${VAR}` and `${VAR:-default}`, and needs **approval** in interactive sessions. (D:mcp)
- `/mcp` opens the interactive list (status, tool counts, browser OAuth sign-in, **Re-authenticate**, **Clear authentication**, **Disable**, **Reconnect**). `/mcp reconnect all` retries failed servers. (D:mcp, D:commands)
- **Resources:** `@github:issue://123`, i.e. `@server:protocol://path`. **Prompts:** shown as `/servername:promptname (MCP)` and runnable as `/mcp__github__pr_review 456`. Tool names in rules and hooks: `mcp__<server>__<tool>`. (D:mcp)

### 4.2 Skills (and custom commands)
- **Custom commands were merged into skills:** `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy`; a skill wins a clash. (D:skills)
- **Where:** `~/.claude/skills/<name>/SKILL.md` (you), `.claude/skills/<name>/SKILL.md` (project), managed, or plugins (`/<plugin>:<skill>`). Edits load live. (D:skills)
- **Frontmatter** (optional; `description` recommended): `name`, `description`, `when_to_use`, `argument-hint`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths`. (D:skills)
- **Invocation:** Claude loads a skill when its description fits the task, or you type `/name args`. `disable-model-invocation: true` makes it manual-only, which suits deploys and commits. (D:skills)
- **Arguments:** `$ARGUMENTS` (all), `$0`, `$1` (0-based). With no placeholder they're appended as `ARGUMENTS: <value>`. Example: `/fix-issue 123`. A line like `` !`git diff HEAD` `` is replaced by the command's output before Claude reads it. `/skills` lists all skills. (D:skills, D:commands)

### 4.3 Hooks
- Commands that run automatically at lifecycle events. They're deterministic, unlike CLAUDE.md instructions. They're configured under `"hooks"` in any settings file, plugin, or skill/agent frontmatter. Handler `type`: `command`, `http`, `mcp_tool`, `prompt`, `agent`. (D:hooks)
- **Canonical example** (lint after edits):
```json
{"hooks":{"PostToolUse":[{"matcher":"Edit|Write","hooks":[{"type":"command","command":"/path/to/lint-check.sh"}]}]}}
```
- **Core events:** `SessionStart`, `UserPromptSubmit`, `PreToolUse` (can block), `PermissionRequest`, `PostToolUse`, `Notification`, `SubagentStop`, `Stop`, `PreCompact`, `SessionEnd`, and more. **Matchers:** tool names such as `Bash`, `Edit|Write`, `mcp__.*`. For `SessionStart`: `startup`, `resume`, `clear`, `compact`, `fork`. (D:hooks)
- **Exit codes:** `0` = success (for `UserPromptSubmit` and `SessionStart`, plain stdout becomes context). `2` = **blocking error**: `PreToolUse` blocks the call, `UserPromptSubmit` rejects the prompt, and stderr is the reason. Anything else is non-blocking and shows a `<hook name> hook error` notice. (D:hooks)
- **`/hooks`** is a **read-only** browser that labels each hook's source. To change hooks, edit the JSON or ask Claude. Scripts can use `$CLAUDE_PROJECT_DIR`. (D:hooks)

### 4.4 Settings files

| Scope | File |
|---|---|
| User | `~/.claude/settings.json` |
| Shared project (commit) | `.claude/settings.json` |
| Project local (kept out of git) | `.claude/settings.local.json` |
| Managed (organisation) | `managed-settings.json`, MDM, server-managed |

- **Precedence:** Managed > command-line flags > local > shared project > user. List keys such as `permissions.allow` **merge**. The files are strict JSON (no comments or trailing commas). (D:settings)
- `/config` opens the settings UI (mostly writes `~/.claude/settings.json`); `/config key=value` sets a key directly. `/status` shows version, model, account and `Setting sources`. MCP servers live in `~/.claude.json`, not settings.json. (D:settings, D:commands, D:mcp)

### 4.5 Plugins
- A plugin bundles skills, agents, hooks and MCP/LSP servers, and can run code, so review it before installing. `/plugin` opens tabs **Discover**, **Installed**, **Marketplaces**, **Errors**. (D:plugins_install)
- `/plugin install commit-commands@claude-plugins-official` asks you to pick a scope: **Install for you (user scope)**, **Install for all collaborators on this repository (project scope)**, or **Install for you, in this repo only (local scope)**. The result is `Plugin is now active.` or `Run /reload-plugins to activate.` (D:plugins_install)
- The official marketplace `claude-plugins-official` is added automatically. Add others with `/plugin marketplace add owner/repo`, which prints `Successfully added marketplace: <name>`. Plugin skills are namespaced, e.g. `/commit-commands:commit`. Shell form: `claude plugin install <p>@<m> --scope project`. (D:plugins_install, H)

---

## Level 5: Automation and scale

### 5.1 Subagents
- Specialised helpers with their **own context window**, system prompt, tools and optional model. They return a summary, which keeps big reads out of your context. Built-in: `Explore` (read-only search: quick, medium or very thorough), `Plan`, `general-purpose`. (D:sub-agents)
- **`/agents` wizard removed (v2.1.198).** `/agents` now just prints a reminder. Create a subagent by asking ("Create a code-improver subagent in ~/.claude/agents/ that …") or by writing the file. (C:2.1.198, D:commands)
- **Locations, by priority:** managed > `--agents '<json>'` > `.claude/agents/` (project) > `~/.claude/agents/` (you) > plugin `agents/`. Changes apply without a restart. (D:sub-agents)
- **File:** Markdown with frontmatter. The body is the system prompt. `name` and `description` are required. Optional: `tools`, `disallowedTools`, `model` (`sonnet`/`opus`/`haiku`/`fable`/`inherit`), `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `isolation`, `color`, … (D:sub-agents)
```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---
You are a code reviewer. …
```
- **Invoke:** automatically by description, in plain language (`Use the test-runner subagent to fix failing tests`), by @-mention (`@"code-reviewer (agent)"` from the picker, or typed `@agent-<name>`), or for a whole session with `claude --agent code-reviewer`. Subagents run in the foreground or background. (D:sub-agents)

### 5.2 Headless mode

| Item | Exact syntax | Notes |
|---|---|---|
| One-shot | `claude -p "What does the auth module do?"` (`--print`) | Prints and exits. Exit code `0` on success |
| Pipes | `cat build-error.txt \| claude -p 'concisely explain the root cause of this build error' > output.txt` | stdin is capped at 10MB |
| Formats | `--output-format text\|json\|stream-json` | `text` is the default. `json` has `result`, `session_id`, `total_cost_usd`. `stream-json` is newline-delimited JSON (the docs pair it with `--verbose`) and ends with a `result` line. `--json-schema` puts the result in `structured_output` |
| Tools | `--allowedTools "Read,Edit,Bash"` / `"Bash(git diff *),Bash(git commit *)"` | Uses permission-rule syntax |
| Mode | `--permission-mode acceptEdits` / `dontAsk` / `auto` | `dontAsk` denies anything that would prompt |
| Turn cap | `--max-turns 3` | Print mode only. Documented, but **hidden from the installed `--help`** |
| Prompt | `--append-system-prompt "…"` · `--system-prompt` (replaces the default) | |
| Continue | `claude -p "…" --continue` · `--resume "$session_id"` | Get the ID with `--output-format json \| jq -r '.session_id'` |
| CI | `--bare` | Skips hooks, skills, plugins, MCP, memory and CLAUDE.md, and needs `ANTHROPIC_API_KEY`. Slated to become the `-p` default |

Sources: D:headless, D:cli-reference, H. Gotchas: a plain `-p` run **does** run the project's hooks and `.mcp.json` servers, with no trust dialog. `/skill-name` works inside `-p`, but `/login` doesn't. `--bg` can't be combined with `-p`.

### 5.3 Worktrees (parallel sessions)
- `claude --worktree feature-auth` (`-w`) creates `.claude/worktrees/feature-auth/` on branch `worktree-feature-auth` and starts there. With no name, it generates one (e.g. `bright-running-fox`). Run another name in a second terminal. (D:worktrees, H)
- Gitignore `.claude/worktrees/` and install dependencies in each worktree; `.worktreeinclude` copies `.env`-style files. On exit, a clean unnamed worktree is removed and one with changes asks to keep or remove. Return with the printed `claude --worktree <name> --resume`. You can also say "work in a worktree" mid-session, and subagents support `isolation: worktree`. (D:worktrees)

### 5.4 Background work
- `Ctrl+B` moves a running Bash command or agent to the background (press twice in tmux); you can also ask Claude to. `/tasks` (alias `/bashes`) lists and stops background work. (D:interactive-mode, D:commands)
- **Background sessions (agent view, research preview):**
  - `claude --bg "investigate the flaky test"` starts a session in the background and prints its id. `claude agents` opens agent view (Needs input / Working / Completed). `claude attach <id>`, `logs`, `stop` and `rm` manage sessions.
  - Inside a session: `/background` (`/bg`) moves this conversation to the background, `/fork` copies it into a new background session (v2.1.212+), and `/subtask <task>` spawns a forked subagent.
  
  (D:agent-view, D:commands, H)

### 5.5 GitHub Actions
- Run `/install-github-app` in `claude` (github.com only). It installs the Claude GitHub App, saves the secret `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`), and opens a workflow PR. Once merged, comment `@claude implement this feature based on the issue description`. The workflow step is `uses: anthropics/claude-code-action@v1`. (D:github-actions)

### 5.6 Agent SDK
- "the same tools, agent loop, and context management that power Claude Code, programmable in Python and TypeScript" (`@anthropic-ai/claude-agent-sdk`). `claude -p` is its CLI form. (D:agent-sdk_overview, D:headless)

---

## Terminal look (for the simulator)

| Element | Verified look | Src |
|---|---|---|
| Startup | Logo area with version, model and working directory above the prompt. Notices underneath overflow as "N more notices hidden". Exact layout **UNVERIFIED** | D:quickstart, C |
| Prompt | `❯` input line **between two horizontal rules** (not a rounded box) | D:permission-modes (screenshot) |
| Status line | `⏵⏵ auto mode on (shift+tab to cycle)` (yellow), plus the mode strings in 3.1 | D:permission-modes |
| Footer hints | `? for shortcuts`, and `esc to interrupt` while working | D:statusline |
| Spinner | A rotating verb (e.g. "Accomplishing", "Architecting", "Baking"; `spinnerVerbs` customises them) or `Thinking…`, with a tip line underneath such as "Use /config to change your default permission mode (including Plan Mode)". The end-of-turn line looks like `✻ Worked for 31s` or `✻ Sautéed for 23s · done 6:05 PM`. The full working-line layout is **UNVERIFIED** | D:settings-reference, D:settings, C |
| Transcript | `●` marks Claude's lines (e.g. `● Learn by Doing`). Collapsed rows like `Called slack 3 times` and `Thought for 4s`. `Ctrl+O` shows the full transcript. `⎿` results and `● Read(file)` rows are **UNVERIFIED** | D:output-styles, D:interactive-mode, C |
| Dialogs | Bash prompt (1.4), plan approval (3.2), rewind menu (3.4) | — |
| Diffs | `/diff` shows changes red/green with line numbers | D:interactive-mode |
| `/mcp` | One row per server with status and tools, e.g. `cached 2h ago · connects on first use · 5 tools`. The detail view has an `Issue:` row | D:mcp |
| Memory | "Saved 2 memories" / "Recalled 2 memories" | D:memory |

---

## Tips (verified)
1. `/` lists every command and skill. `?` shows the shortcuts.
2. `Shift+Tab` cycles modes; watch the status line.
3. `Esc` interrupts without losing work; `Esc` `Esc` on an empty prompt rewinds.
4. `Ctrl+G` edits your prompt, or the plan, in your text editor.
5. `\` + `Enter` adds a new line in any terminal.
6. `Ctrl+R` searches prompt history.
7. `Ctrl+S` stashes a draft, and pressing it again restores it.
8. `Ctrl+O` opens the detailed transcript.
9. `Ctrl+T` toggles Claude's to-do checklist.
10. `Ctrl+B` backgrounds a long command; `/tasks` shows it.
11. `/btw <question>` asks a side question without adding it to the conversation.
12. `/copy` copies the last answer; `/copy 2` the one before.
13. `/diff` reviews every change in the working tree.
14. `/usage` (alias `/cost`) shows cost and plan limits.
15. `/doctor` diagnoses your setup and can fix problems.
16. `/compact focus on X` steers the summary.
17. `/clear` between unrelated tasks; the old chat stays in `/resume`.
18. `claude -c` picks up where you left off.
19. `claude -n <name>` and `/rename` make sessions easy to find.
20. `ultrathink` asks for one turn of deeper reasoning.
21. `Alt+P`/`Option+P` switches model without losing your prompt.
22. `/plan <task>` starts plan mode with a task.
23. `! git status` runs it yourself, and Claude comments on the output.
24. A deny rule like `Read(./.env)` blocks secrets in every mode.
25. `claude -p "…" --output-format json | jq -r '.result'` puts Claude in a script.

---

## Changed / deprecated (older knowledge gets these wrong)

| Older belief | Current fact | Version |
|---|---|---|
| `#` saves a memory | Removed. Say "add this to CLAUDE.md" or use `/memory` | 2.0.70 |
| `/agents` opens a wizard | Removed. It only prints a reminder; ask Claude or edit `.claude/agents/` | 2.1.198 |
| Sessions start in a mode that asks for everything | Start in **auto**; Manual has to be chosen | 2.1.228 (Pro/Max/Team), 2.1.283–284 (all) |
| The base mode is "default"/"normal" | Labelled **Manual** (`⏸ manual mode on`, alias `manual`); the config value is still `default` | 2.1.200 |
| `!` output is added silently | Claude **responds** to it (`respondToBashCommands: false` restores silent) | 2.1.186 |
| Custom commands are separate from skills | Merged into skills; `.claude/commands/` still works | — |
| "think hard"/"think harder" keywords | Ordinary words. Use `ultrathink` or `/effort` | — |
| Auto mode needs `--enable-auto-mode` | Not needed | 2.1.111 |
| Plan approval says "auto-accept edits" | **Yes, and use auto mode** / **Yes, manually approve edits** / **No, keep planning** | current |
| `/review` is its own command | Alias of `/code-review`. `/ultrareview` = `/code-review ultra` | 2.1.223 |
| `/fork` spawns a forked subagent | Copies the session into a background session. The subagent version is `/subtask` | 2.1.212 |
| `/vim` toggles vim mode | Removed. Use `/config` → Editor mode | 2.1.92 |
| `/hooks` edits hooks | Read-only browser | current |
| SSE is a normal MCP transport | Deprecated; HTTP falls back to SSE automatically | 2.1.265 |
| Instructions need a CLAUDE.md | `AGENTS.md` is read when there's no CLAUDE.md | 2.1.277 |

---

## UNVERIFIED (never present as exact)
- The workspace trust dialog wording.
- The file edit/create permission dialog (only the Bash dialog is verified).
- The `⎿` result glyph and tool rows such as `● Bash(npm test)`.
- The full spinner line (position of elapsed time, tokens and `esc to interrupt`).
- The startup box layout and text.
- `/context` categories beyond those listed in 2.2, and the `/compact` completion message.
- The `/mcp`, `/memory` and `/help` screen layouts beyond the quoted strings.
- Whether `--permission-mode default` is accepted on 2.1.281 (its help lists only `manual`).
