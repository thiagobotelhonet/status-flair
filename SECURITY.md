# Security policy

## Supported versions

Only the latest release on the Visual Studio Marketplace gets fixes. Please update before reporting.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting instead: go to the **Security** tab of this repository and choose **Report a vulnerability**. Include what an attacker could do, the steps to reproduce it, and the versions involved.

You should get a first reply within a week. Once a fix is released, the advisory is published with credit to you, unless you prefer to stay anonymous.

## What is in scope

Status Flair runs code outside VS Code and edits configuration files, so these areas matter most:

- the hook and status line scripts it installs into `~/.claude/status-flair` and registers in `~/.claude/settings.json`, which Claude Code runs on every tool call;
- the way it reads and rewrites `~/.claude/settings.json` and `workbench.colorCustomizations`;
- the commands it runs: `git`, `gh`, `node`, and PowerShell for Windows notifications;
- the Claude Lens webview, which renders text taken from Claude Code sessions.

Problems in Claude Code, git, the GitHub CLI or VS Code itself should go to those projects.
