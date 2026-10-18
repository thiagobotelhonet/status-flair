# Status Flair

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/thiagobotelhonet.status-flair?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=thiagobotelhonet.status-flair)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/thiagobotelhonet.status-flair)](https://marketplace.visualstudio.com/items?itemName=thiagobotelhonet.status-flair)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Status Flair puts your own item and colors in the VS Code status bar. If you work with Claude Code, it also shows what each session is doing, how much of your plan is left, and which agent finished in which git worktree.

> Status Flair is an independent project. It is not made by, affiliated with, or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, used here only to describe compatibility.

![The status bar with Status Flair's six items numbered](docs/images/status-bar.png)

| # | Item | What it tells you |
| --- | --- | --- |
| 1 | Your item | Anything you want: your name, the branch, plan usage. Click it to pick a color. |
| 2 | Worktree | Which worktree this window is in and how many the repository has. The bell counts other worktrees where Claude is waiting for you. |
| 3 | Pull request | The branch's PR, its checks and its review. |
| 4 | Claude Lens | What Claude is doing right now. Click it for the live panel. |
| 5 | Claude sessions | Every session on the machine: waiting for you, finished and unread, working. |
| 6 | Claude | This window's session: its state, model and context size. Hover it for plan usage. |

## Install

Search for "Status Flair" in the Extensions view, or run:

```bash
code --install-extension thiagobotelhonet.status-flair
```

You need VS Code 1.90 or later. Everything else is optional and only matters for the feature that uses it:

| Feature | Needs |
| --- | --- |
| Claude Code items, Lens, sessions inbox | Claude Code, and Node.js on your PATH for the hooks |
| Worktrees | git |
| Pull request and CI status | The [GitHub CLI](https://cli.github.com), signed in |

## Your own status bar item

By default the item shows a flame and your user name. You can change the text, icon, tooltip, side and position, and choose what a click does.

```jsonc
"statusFlair.item.text": "${user} on ${gitBranch}",
"statusFlair.item.icon": "$(heart)",          // a codicon, or an emoji like "🔥"
"statusFlair.item.tooltip": "Last check: ${time}",
"statusFlair.item.clickAction": "openUrl",    // none | openSettings | pickColor | openUrl | runCommand | openClaude
"statusFlair.item.clickValue": "https://github.com"
```

These variables work in any text or tooltip:

| Variable | Value |
| --- | --- |
| `${user}` | Your OS user name |
| `${workspaceName}` | Workspace name |
| `${folderName}` | Folder of the active file |
| `${gitBranch}` | Current git branch |
| `${worktreeName}` / `${worktreeCount}` | Current worktree and how many the repository has |
| `${prNumber}` / `${issueTitle}` | Pull request of the branch, like `#62`, and the title of the issue its name points to |
| `${time}` / `${date}` | Current time and date |
| `${claudeModel}` | Model of the latest Claude Code session in this workspace |
| `${claudeContext}` / `${claudeContextPercent}` | Its context size, like `49k`, and how full the window is, like `16%` |
| `${claudeState}` | `working`, `waiting for you`, `done` and so on |
| `${claudeUsage5h}` / `${claudeUsageWeek}` | Plan usage in the 5-hour and weekly windows, like `41%` |
| `${claudeCost}` | Session cost as Claude Code reports it, like `$4.12` |

When a variable at the start or end of the text has no value, the separator next to it goes away too, so `${claudeModel} · ${claudeContext}` shows just the model when the context is unknown.

For more items, add them to `statusFlair.extraItems`:

```jsonc
"statusFlair.extraItems": [
  { "icon": "$(book)", "text": "Docs", "url": "https://code.visualstudio.com/docs" },
  { "icon": "$(terminal)", "command": "workbench.action.terminal.new", "alignment": "right" }
]
```

## Status bar colors

![Moving through the color presets previews each one on the status bar](docs/images/color-picker.gif)

Run **Status Flair: Pick Status Bar Color** and move through the presets; the bar previews each one as you go. You can also type a hex color or roll a random one. Random colors keep white text readable at a 4.5:1 contrast ratio.

If you only set `statusFlair.colors.background`, the rest is derived from it: a readable text color, and darker shades for "no folder", debugging and the remote indicator. You can set any of them yourself.

To give one project its own color, run **Status Flair: Pick Color for This Workspace**. The color goes to that project's `.vscode/settings.json`, which makes windows of different projects easy to tell apart. Set `statusFlair.colors.target` to `workspace` to make that the default.

Status Flair remembers what each color key held before it took it over and restores it when you remove the color or run **Status Flair: Reset Colors**. It writes to `settings.json` only when a value actually changes.

## Claude Code

![The Claude items going from idle to working, waiting for approval, and done](docs/images/claude-states.gif)

When a Claude Code session runs in the open folder, the Claude item shows its model and context size. The icon tells you the state:

| Icon | State |
| --- | --- |
| ![Idle](docs/images/icons/claude-idle.png) | Idle, nothing running |
| ![Working](docs/images/icons/claude-working.png) | Working (the icon spins) |
| ![Waiting](docs/images/icons/claude-waiting.png) | Waiting for your permission or your answer; the item turns amber |
| ![Done](docs/images/icons/claude-done.png) | Just finished |
| ![Error](docs/images/icons/claude-error.png) | The turn stopped with an API error; the item turns red |

The item also turns amber when a plan limit passes `statusFlair.claude.usageWarningThreshold` (80% by default) or the context passes `contextWarningThreshold` (70%). Clicking it opens Claude Code.

### Plan usage

![The usage panel with plan limits, pace forecasts, context and session totals](docs/images/usage-panel.png)

Hover the Claude item to see:

- the 5-hour and weekly limits with their reset times, and the weekly limit per model when Claude Code reports one;
- your pace, once there are a few readings: "On pace for about 68% by reset", or in red, "At this pace it runs out Thu 3:00 PM";
- the context window, with a hint to `/compact` when it is getting full;
- the session's cost, tokens, how long Claude worked and how long it waited for you, and where the limits came from.

Bars are blue, turn amber as they get close to the warning threshold, and red past it.

Model and token counts come from Claude Code's local transcripts in `~/.claude/projects`, so they work right away. Plan limits come from your `/usage` reports and from Claude Code's [status line input](https://code.claude.com/docs/en/statusline), and are only reported for Pro and Max plans. Run `/usage` in Claude Code to refresh them.

### Connecting to Claude Code

Live state, the Lens and plan limits from the status line need a one-time setup: run **Status Flair: Connect to Claude Code**. You are also asked once on first run. It edits `~/.claude/settings.json` after saving a backup next to it, and adds:

- hooks that record each session's state and current activity, next to any hooks you already have;
- a status line recorder that saves `rate_limits`, `context_window` and `cost`. If you already have a status line, it keeps working: it gets the same input and its output is unchanged.

Both scripts print nothing, always exit successfully, and only write small files under `~/.claude/status-flair`, so they cannot change what Claude does. **Status Flair: Disconnect from Claude Code** removes them and puts your previous status line back exactly. If another tool replaces the status line later, Status Flair notices and offers to reconnect.

### Every session in one place

![The sessions picker with a session waiting, two finished and unread, and one working](docs/images/claude-inbox.png)

With several sessions open across projects and worktrees, the sessions item counts them:

| Icon | Meaning |
| --- | --- |
| ![Waiting](docs/images/icons/claude-waiting.png) `1` | Sessions waiting for you; the item turns amber |
| ![Finished](docs/images/icons/inbox-unread.png) `2` | Sessions that finished and you have not looked at yet |
| ![Working](docs/images/icons/claude-working.png) `3` | Sessions working |
| ![Error](docs/images/icons/claude-error.png) `1` | Sessions that stopped with an error and you have not seen; the item turns red |

Click it to see each session with the start of its prompt and how long Claude has worked and waited for you, then jump to its window. A finished session counts as read once you open it or focus its window, or when you choose "Mark all as read".

You also get a message when a session needs you or finishes, naming the project and worktree ("Claude finished · hub-preditivo / 048-operacao"), or a desktop notification when VS Code is in the background. Nothing shows when you are already looking at that session's window, and only one VS Code window notifies.

### Claude Lens

![The Claude Lens panel updating as Claude reads, delegates to a subagent, edits, fails a type check, fixes it and runs the tests](docs/images/claude-lens.gif)

The Lens item (![Lens](docs/images/icons/lens.png)) shows what Claude is doing right now, like `Editing controller.ts`, or `Approve Bash: rm -rf dist` when a command needs your permission. Click it to open the Claude Lens panel, which updates live with:

- the current action and how long it has been running;
- the subagents that are running or done;
- this turn's timeline: commands with their result and duration, reads, edits, searches, and the calls subagents made (tagged with the subagent's type);
- the files changed this turn, with lines added and removed. Click one to open it.

The dropdown at the top switches between sessions on the machine. The Lens also works when you use Claude Code from its VS Code extension, where Claude Code's own terminal plugins do not draw.

## Git worktrees

![The worktree picker with each worktree's branch, pull request, issue, Claude state and changes](docs/images/worktree-picker.png)

In a git repository, the worktree item (![Worktree](docs/images/icons/worktree.png)) shows the worktree this window is in and how many there are, with a bell (![Bell](docs/images/icons/bell.png)) counting other worktrees where Claude is waiting for you. With a single worktree it shows only the icon. Click it to switch.

Each row shows the branch, its pull request and the issue it points to, Claude's state there, and whether it has uncommitted changes. Enter opens the worktree in a new window; the buttons on the highlighted row open it in this window, copy its path, or delete it.

New worktree asks for a branch. An existing branch is checked out as is. A new one starts from an up-to-date shared base, by default the main worktree's branch on the remote (like `origin/developer`), and never from the worktree you happen to be in, so a new task does not inherit another task's commits and the agents working elsewhere are not touched. The branch button picks a different base. The worktree goes to `statusFlair.worktrees.location`, which defaults to Claude Code's `.claude/worktrees/<branch>`. Folders inside the repository are added to `.git/info/exclude`, which is local and never committed, and files listed in `statusFlair.worktrees.copyFiles` (like `.env`) are copied over.

Clean up worktrees fetches first, then lists the worktrees you can let go of. Worktrees whose branch or pull request was merged, whose remote branch was deleted, or whose folder no longer exists come pre-selected. Ones with no commits for `staleDays` are listed but not selected. The main worktree and the one in this window are never offered, and worktrees with uncommitted changes or an active Claude session are flagged and left unselected. Branches are only deleted if you confirm it in a second step.

`statusFlair.worktrees.autoColor` gives each worktree a stable color derived from its name. It only writes `.vscode/settings.json` where git ignores that file, and offers to ignore it locally.

## Pull requests and issues

![The pull request item and its tooltip, with passing checks on the left and a failing check on the right](docs/images/pull-request.png)

With the GitHub CLI signed in, the pull request item shows the current branch's PR. The first icon is the PR's state, then its checks and review:

| Icon | Meaning |
| --- | --- |
| ![Open](docs/images/icons/pr-open.png) | Open pull request |
| ![Draft](docs/images/icons/pr-draft.png) | Draft |
| ![Merged](docs/images/icons/pr-merged.png) | Merged |
| ![Closed](docs/images/icons/pr-closed.png) | Closed without merging |
| ![Passing](docs/images/icons/checks-passing.png) | All checks passed |
| ![Running](docs/images/icons/checks-running.png) | Checks still running |
| ![Failing](docs/images/icons/checks-failing.png) | A check failed; the item turns red |
| ![Approved](docs/images/icons/approved.png) | Approved by a reviewer |

The tooltip lists failing checks with links to their logs, the review state, and the issue the branch name points to: a branch called `feat/056-password-reset` links issue #56. A click opens the PR, or offers to create one when the branch has none.

## Examples

Show the branch and its pull request in your item:

```jsonc
"statusFlair.item.icon": "$(git-branch)",
"statusFlair.item.text": "${gitBranch} ${prNumber}"
```

Keep an eye on your plan without hovering:

```jsonc
"statusFlair.item.icon": "$(dashboard)",
"statusFlair.item.text": "5h ${claudeUsage5h} · week ${claudeUsageWeek}"
```

Give a client project its own color, in that project's `.vscode/settings.json`:

```jsonc
"statusFlair.colors.target": "workspace",
"statusFlair.colors.background": "#00796b"
```

Bring your local environment files into every new worktree:

```jsonc
"statusFlair.worktrees.copyFiles": [".env", ".env.local"]
```

Keep worktrees next to the repository instead of inside it:

```jsonc
"statusFlair.worktrees.location": "${repoParent}/${repoName}.worktrees/${branchSlug}"
```

Only be notified when Claude needs you, not when it finishes:

```jsonc
"statusFlair.claude.notify": "waiting"
```

Add a button that runs your test task:

```jsonc
"statusFlair.extraItems": [
  { "icon": "$(beaker)", "text": "Test", "command": "workbench.action.tasks.test" }
]
```

## Commands

| Command | What it does |
| --- | --- |
| Status Flair: Pick Status Bar Color | Presets with live preview, custom hex, random |
| Status Flair: Pick Color for This Workspace | The same, saved to this project only |
| Status Flair: Random Status Bar Color | Rolls a new color |
| Status Flair: Reset Colors | Removes every color Status Flair set and restores what was there |
| Status Flair: Connect to / Disconnect from Claude Code | Installs or removes the hooks and status line recorder |
| Status Flair: Go to Claude Session… | Lists every active session and jumps to its window |
| Status Flair: Show Claude Lens | Opens the Lens panel |
| Status Flair: Open Claude Code | Opens Claude Code |
| Status Flair: Open Pull Request | Opens the current branch's PR, or creates one |
| Status Flair: Switch Worktree… | Opens the worktree picker |
| Status Flair: New Worktree… | Creates a worktree and opens it |
| Status Flair: Clean Up Worktrees… | Deletes merged or abandoned worktrees after you confirm |
| Status Flair: Open Settings | Shows all Status Flair settings |

All settings live under `statusFlair.*`; search for "Status Flair" in the Settings editor to see them with their descriptions. Every item can be turned off on its own with its `enabled` setting (or `statusFlair.claude.lens` and `statusFlair.claude.inbox` for the Lens and the sessions inbox).

## Privacy

Status Flair has no telemetry and no servers. It reads Claude Code's local transcripts and the state files its own scripts write, and calls `git` and `gh` on your machine. The only network traffic is what those tools do on your behalf: `git fetch` before creating or cleaning up worktrees, and GitHub CLI requests for pull requests and issues. Desktop notifications on Windows go through PowerShell.

The files it writes outside your workspace are `~/.claude/settings.json` (only when you connect or disconnect, with a backup) and the small state files under `~/.claude/status-flair`.

## Uninstalling

VS Code gives extensions no chance to clean up when they are uninstalled. Before removing Status Flair, run **Status Flair: Reset Colors** and **Status Flair: Disconnect from Claude Code** so your settings and Claude Code configuration go back to how they were.

The scripts run with `node`, which must be on your PATH. If you use `CLAUDE_CONFIG_DIR`, Status Flair picks it up, or you can set `statusFlair.claude.configDir`.

## Contributing

Bug reports, ideas and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to build, test and debug the extension, and how the code is organized. Please read the [code of conduct](CODE_OF_CONDUCT.md) first, and report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
