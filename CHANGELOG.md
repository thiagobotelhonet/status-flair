# Changelog

## 0.4.0

- Claude Lens: a live panel (activity bar) showing what each Claude Code session is doing: current action with a timer, subagents, this turn's timeline with results and durations, and files changed with +/- lines. A status bar item shows the current action (`Editing controller.ts`) and opens it. Works with the Claude Code VS Code extension.
- Finished sessions stay as unread in the Claude inbox (`✓ 2`) until you open them, so you know which worktree's agent is done; "Mark all as read" in the picker.
- Notifications now also cover finished sessions by default (`statusFlair.claude.notify: all`), naming the project and worktree.
- The hook records concurrent tool calls safely (parallel tools and subagents no longer overwrite each other).

## 0.3.1

- New worktrees start from an up-to-date shared base (the main worktree's branch on the remote, e.g. `origin/developer`) instead of the branch of the window you are in, so a new task never inherits an agent's commits. Pick another base with the branch button, or set `statusFlair.worktrees.base`.
- New branches no longer track their base, so pushes and cleanup follow the right branch.
- Untracked files listed in `copyFiles` are copied from the main worktree.

## 0.3.0

- Claude inbox: every active Claude Code session on the machine in one item, sorted by urgency, with prompt snippets, time worked and waited, and a jump to its window
- Notifications for sessions in any project: in VS Code when focused, desktop otherwise; deduplicated across windows and skipped when you are already looking at the session
- Context warning with a `/compact` hint, and plan usage forecasts ("runs out Thu 3:00 PM")
- Pull request item with CI checks and review state via the GitHub CLI; issue title from the branch name
- PRs and issues in the worktree picker; clean up treats merged PRs as merged (squash merges included)
- `${prNumber}` and `${issueTitle}` variables

## 0.2.0

- Git worktree item and picker: switch, create, delete, copy path, with each worktree's Claude Code state and pending changes
- New worktrees in a configurable location (Claude Code's `.claude/worktrees` by default), kept out of git locally, with optional files like `.env` copied over
- Clean up worktrees: suggests merged, remote-deleted and missing worktrees, protects uncommitted work and active Claude sessions, optionally deletes merged branches
- Optional automatic color per worktree
- `${worktreeName}` and `${worktreeCount}` variables
- Claude usage panel drawn as an image with real progress bars; context window size from `/usage`
- Claude sessions in nested worktrees no longer count toward the main folder's state

## 0.1.0

First release.

- Custom status bar item with codicons or emoji, variables, alignment, priority and click actions
- Extra items via `statusFlair.extraItems`
- Status bar colors with derived shades, live-preview picker, presets, random colors
- Colors per workspace or global, with backup and restore of previous values
- Claude Code item: model, context size and session totals from local transcripts
- Live Claude Code state (working, waiting, done) through optional hooks, with optional status bar colorizing and notifications
- Claude Code usage panel: 5-hour and weekly plan limits, context window and session cost from the documented status line input, keeping any existing status line working
