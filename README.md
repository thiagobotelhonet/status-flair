# Status Flair

Make the VS Code status bar yours: a personal item, colors for the whole bar or for each project, and a live Claude Code indicator that tells you when Claude is working, waiting for you, or done.

> Status Flair is an independent project. It is not made by, affiliated with, or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, used here only to describe compatibility.

## Features

### Your own item

Shows `$(flame) <your user name>` by default. Change the text, icon, tooltip, side and position, and choose what a click does.

```jsonc
"statusFlair.item.text": "${user} on ${gitBranch}",
"statusFlair.item.icon": "$(heart)",          // a codicon, or an emoji like "🔥"
"statusFlair.item.tooltip": "Last check: ${time}",
"statusFlair.item.clickAction": "openUrl",    // none | openSettings | pickColor | openUrl | runCommand | openClaude
"statusFlair.item.clickValue": "https://github.com"
```

Variables that work in any text or tooltip:

| Variable | Value |
| --- | --- |
| `${user}` | Your OS user name |
| `${workspaceName}` | Workspace name |
| `${folderName}` | Folder of the active file |
| `${gitBranch}` | Current Git branch |
| `${time}` / `${date}` | Current time / date |
| `${claudeModel}` | Model of the latest Claude Code session in this workspace |
| `${claudeContext}` | Its context size, like `49k` |
| `${claudeContextPercent}` | How full the context window is, like `16%` |
| `${claudeState}` | `working`, `waiting for you`, `done`… |
| `${claudeUsage5h}` / `${claudeUsageWeek}` | Plan usage in the 5-hour and weekly windows, like `41%` |
| `${claudeCost}` | Session cost as Claude Code reports it, like `$4.12` |

Need more items? Add them to `statusFlair.extraItems`:

```jsonc
"statusFlair.extraItems": [
  { "icon": "$(book)", "text": "Docs", "url": "https://code.visualstudio.com/docs" },
  { "icon": "$(terminal)", "command": "workbench.action.terminal.new", "alignment": "right" }
]
```

### Status bar colors

Run **Status Flair: Pick Status Bar Color** and move through the presets: the bar previews each one live. You can also enter any hex color or roll a random one. Random colors always keep white text readable (4.5:1 contrast).

Set only `statusFlair.colors.background` and the rest is derived for you: text color for contrast, plus darker shades for "no folder", debugging, and the remote indicator. Any of them can be set explicitly.

**One color per project.** Run **Status Flair: Pick Color for This Workspace** and the color goes to that project's `.vscode/settings.json`. Windows of different projects then look different at a glance. To make this the default, set `statusFlair.colors.target` to `workspace`.

**Your settings are safe.** Status Flair remembers what each color key held before it took it over, and puts it back when you remove the color or run **Status Flair: Reset Colors**. It only writes to `settings.json` when something actually changes.

### Claude Code

When Claude Code has a session in the open folder, a Claude item appears in the status bar showing the model and how full the context is:

| Icon | State |
| --- | --- |
| ✦ | Idle |
| ⟳ (spinning) | Claude is working |
| 🔔 (warning background) | Claude is waiting for your permission or answer |
| ✓ | Claude just finished |

Hover it for a usage panel:

```text
Claude Code · Opus 5.5 — working
─────────────────────────────────────────
Session (5h) · resets 14:20
████████░░░░░░░░░░░░ 41% used

Weekly · resets Fri 21:00
███░░░░░░░░░░░░░░░░░ 15% used

Context · 155k / 1M tokens
███░░░░░░░░░░░░░░░░░ 16%
─────────────────────────────────────────
This session: $4.12 · 75k out · 112k in · 2M cached · 23 responses
Limits updated 2 min ago
Open Claude · Settings
```

The item turns amber when the 5-hour or weekly usage passes `statusFlair.claude.usageWarningThreshold` (80% by default). Clicking it opens Claude Code.

Model and token counts are read from Claude Code's local transcripts (`~/.claude/projects`), so they work out of the box. **Live state and plan usage need the integration:** run **Status Flair: Connect to Claude Code** (you will also be asked once on first run). It edits `~/.claude/settings.json`, keeps a backup of the file, and adds two things:

- **Hooks** that record whether each session is working, waiting for you, or done. Your other hooks are left untouched.
- **A status line recorder.** Plan limits are only published through Claude Code's documented [status line input](https://code.claude.com/docs/en/statusline), so Status Flair registers a small script there that saves `rate_limits`, `context_window` and `cost`. If you already have a status line, it is kept: it receives the same input and its output is unchanged.

Both scripts print nothing, always exit successfully, and only write small files under `~/.claude/status-flair`, so they cannot change what Claude does. **Status Flair: Disconnect from Claude Code** removes them and restores your previous status line exactly. If another tool later replaces the status line, Status Flair notices and offers to reconnect.

Plan limits are only reported for Claude Pro and Max subscribers, after the first response of a session. They are account-wide, so any session refreshes them.

**All your Claude sessions in one place.** When you run several Claude sessions across projects and worktrees, an inbox item shows them all: `$(bell-dot) 2  $(loading~spin) 3` means two are waiting for you and three are working. Click it to see each one (longest wait first) with the start of its prompt and how long Claude has worked and waited for you, then jump straight to its window. When a session needs you or finishes, you get a VS Code message, or a desktop notification when VS Code is in the background. Nothing shows when you are already looking at that session's window, and only one window notifies (`statusFlair.claude.notify`).

**Claude Lens: what the AI is doing right now.** A status bar item shows the current action, like `Editing controller.ts` or `Approve Bash: rm -rf dist`. Click it to open the Claude Lens panel, which updates live: the current action with a timer, subagents running and done, this turn's timeline (commands with ✓/✗ and duration, edits, searches, calls made by subagents) and the files changed with +/- lines. Pick any session on the machine from its dropdown. It works with the Claude Code extension's panel, where Claude Code's own terminal plugins cannot draw.

**Know which agent finished, and where.** Finished sessions stay in the inbox as unread (`✓ 2`) until you open them, and you get a message naming the project and worktree: "Claude finished · hub-preditivo / 048-operacao", with a button to jump there.

**Context and limits ahead of time.** The Claude item turns amber when the context passes `contextWarningThreshold` (70%) and the panel suggests `/compact`. With a few readings of your plan usage, the panel projects the pace: "At this pace it runs out Thu 3:00 PM" or "On pace for about 60% by reset".

Optional extras:

- `statusFlair.claude.colorizeStatusBar`: paint the whole bar blue while Claude works, amber while it waits, and green when it finishes. Colors are configurable. This writes to the workspace settings so each project window shows its own state.
- `statusFlair.claude.notify`: get a VS Code notification when Claude needs you (or also when it finishes) and the window is not focused.

### Git worktrees

In a git repository, a worktree item shows where you are: `$(worktree) feat-login · 4`. A bell appears when Claude is waiting for you in another worktree.

Click it to switch:

```text
 Worktrees · hub-preditivo
 ─────────────────────────────────────────────────
 $(repo) hub-preditivo      developer · this window
 🔔 048-operacao            docs/048-regras   Claude waiting for you · clean
 ⟳ 063-board-pr             ci/063-board      Claude working · 2 changes
 ─────────────────────────────────────────────────
 + New worktree…
 ✦ New worktree with Claude…
 🗑 Clean up worktrees…
```

- **Enter** opens the worktree in a new window. The row buttons open it in this window, copy its path, or delete it.
- **New worktree** asks for a branch: an existing one is checked out as is; a new one starts from an up-to-date shared base, by default the main worktree's branch on the remote (like `origin/developer`), never from the worktree you are in. Other worktrees, and the agents working in them, are not touched. The branch button picks another base. It goes to `statusFlair.worktrees.location`, which defaults to Claude Code's `.claude/worktrees/<branch>`. Folders inside the repository are added to `.git/info/exclude` (local, never committed). Files listed in `statusFlair.worktrees.copyFiles` (like `.env`) are copied over.
- **Clean up worktrees** fetches, then lists worktrees you can let go of. Merged branches, branches whose remote was deleted after the PR, and folders that no longer exist are pre-selected. Stale ones (no commits for `staleDays`) are listed but not selected. The main worktree and this window's are never offered, and worktrees with uncommitted changes or an active Claude session are flagged and left unselected. Branches are kept unless you confirm deleting them in a second step. "Merged" means merged into origin's default branch or into the main worktree's branch (like `developer`).

Optional: `statusFlair.worktrees.autoColor` gives each worktree a stable color derived from its name, so windows are easy to tell apart. It only writes `.vscode/settings.json` where git ignores it, and offers to ignore it locally.

### Pull requests and issues

With the [GitHub CLI](https://cli.github.com) signed in, a pull request item shows the current branch's PR and CI: `$(git-pull-request) #62 $(check) $(pass)` (checks passing, approved), `$(x)` with a red background when checks fail. The tooltip lists failing checks with links, the review state, and the issue the branch points to (`feat/056-…` → issue #56). Click to open the PR, or to create one when the branch has none.

The worktree picker shows each worktree's PR and issue, and clean up treats a merged PR as merged, which also catches squash merges that git cannot see.

## Commands

| Command | |
| --- | --- |
| Status Flair: Pick Status Bar Color | Presets with live preview, custom hex, random |
| Status Flair: Pick Color for This Workspace | Same, saved to this project only |
| Status Flair: Random Status Bar Color | Roll a new color |
| Status Flair: Reset Colors | Remove every color Status Flair set and restore what was there |
| Status Flair: Open Claude Code | Open Claude Code |
| Status Flair: Connect to / Disconnect from Claude Code | Manage the live state and usage integration |
| Status Flair: Go to Claude Session… | Every active Claude session, jump to its window |
| Status Flair: Open Pull Request | Open (or create) the current branch's PR |
| Status Flair: Switch Worktree… | Worktree picker |
| Status Flair: New Worktree… | Create a worktree and open it |
| Status Flair: Clean Up Worktrees… | Delete merged or abandoned worktrees, with confirmation |
| Status Flair: Open Settings | Jump to all settings |

## Notes

- Uninstalling the extension does not clean `settings.json` (VS Code gives extensions no chance to). Run **Reset Colors** and **Disconnect from Claude Code** first.
- The scripts run with `node`, which must be on your PATH.
- If you use `CLAUDE_CONFIG_DIR`, it is picked up automatically, or you can set `statusFlair.claude.configDir`.

## Development

```bash
npm install
npm test          # compiles and runs the unit tests
npm run package   # builds status-flair-<version>.vsix
```

Press F5 in VS Code to launch an Extension Development Host.

## License

[MIT](LICENSE)
