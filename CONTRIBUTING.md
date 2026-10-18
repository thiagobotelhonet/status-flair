# Contributing to Status Flair

Thanks for taking the time to help. This guide covers how to get the extension running from source, how the code is laid out, and what a pull request needs before it can be merged.

## Getting started

You need Node.js 22 or later (the test runner uses glob patterns), git, and VS Code 1.90 or later.

```bash
git clone https://github.com/thiagobotelhonet/status-flair.git
cd status-flair
npm install
npm test
```

`npm test` compiles the TypeScript and runs the unit tests with Node's built-in test runner. There is no separate build step for development.

To try your changes, open the folder in VS Code and press F5. That starts the `npm: watch` task and launches an Extension Development Host with your build loaded. Reload that window (`Developer: Reload Window`) after each change.

## How the code is organized

| Path | What lives there |
| --- | --- |
| `src/extension.ts` | Activation: creates the controllers and registers commands |
| `src/items.ts`, `src/template.ts`, `src/variables.ts` | The custom item and `${variable}` rendering |
| `src/colors.ts`, `src/colorManager.ts`, `src/colorPicker.ts` | Color math, writing `workbench.colorCustomizations`, the picker |
| `src/claude/` | Everything Claude Code: transcripts, hooks, the usage panel, the inbox, the Lens |
| `src/worktrees/` | The worktree item, picker, creation and clean up |
| `src/github/` | Pull request, checks and issue lookups through the GitHub CLI |
| `resources/` | The hook and status line scripts that get copied into `~/.claude/status-flair` |
| `src/test/` | Unit tests |

Most features are split in two. A model file (`model.ts`, `transcript.ts`, `usage.ts`, `inboxModel.ts` and so on) holds the logic and never imports `vscode`, so the tests can run it directly. The controller next to it talks to the VS Code API and should stay thin. If you are adding logic, put it on the model side and test it there.

The extension has no runtime dependencies, and we would like to keep it that way. If you think one is worth it, open an issue first.

## Things to keep in mind

The scripts in `resources/` run inside Claude Code on every tool call. They must never print anything, must always exit with code 0, and must finish fast. A bug there should cost a status update, never a Claude session. They also run concurrently (parallel tool calls, subagents), which is why the hook takes a lock before it rewrites a state file.

Status Flair edits other people's settings: `workbench.colorCustomizations` and `~/.claude/settings.json`. Changes in that area need to keep what was there before and be fully reversible. `mergeOwned` in `src/colors.ts` and `removeHooks` / `restoreStatusLine` in `src/claude/hooksConfig.ts` show how that is done today.

Claude Code's transcript format and the `/usage` report are not documented and may change. Code that reads them should treat every field as optional and fail quietly.

## Testing the Claude Code integration without touching your setup

Connecting to Claude Code edits your real `~/.claude/settings.json`. To experiment safely, point both sides at a scratch directory:

1. Start Claude Code with `CLAUDE_CONFIG_DIR` set to an empty folder, for example `CLAUDE_CONFIG_DIR=/tmp/claude-test claude`.
2. In the Extension Development Host, set `statusFlair.claude.configDir` to the same folder.
3. Run **Status Flair: Connect to Claude Code**. The hooks and status line now go to the scratch folder only.

The tests in `src/test/hookScript.test.ts`, `lens.test.ts` and `statusLine.test.ts` run the real scripts as child processes with JSON on stdin, the same way Claude Code calls them. When you change a script, extend those tests.

## Tests

Tests use `node:test` and `node:assert`. Some of them create real git repositories in a temporary folder, so git has to be on your PATH; the status line test also needs a POSIX shell (Git Bash on Windows) and skips itself when there is none.

Please add or update tests for any change in a model file or a script. Pure UI changes in a controller are fine to test by hand, but say how you did it in the pull request.

## Pull requests

- Keep each pull request to one change. Small ones get reviewed faster.
- Run `npm test` before you push. CI runs it on Linux and Windows.
- Describe what you changed and how you tried it. For anything visible, a screenshot helps a lot.
- Add a line to `CHANGELOG.md` under an `Unreleased` heading for anything a user would notice.
- Match the style of the code around your change. The project uses strict TypeScript; comments explain why something is done, not what the next line does.

## Reporting bugs and asking for features

Use the issue templates. For bugs, the versions of VS Code, Status Flair and (when relevant) Claude Code, plus the steps to reproduce, save a lot of back and forth. If the problem is in the Claude Code integration, say whether you ran **Connect to Claude Code** and whether you use Claude Code from the terminal or from its VS Code extension.

Security problems should not go in a public issue. See [SECURITY.md](SECURITY.md).

## Releasing

For maintainers:

1. Update `version` in `package.json` and move the `Unreleased` notes in `CHANGELOG.md` under the new version.
2. Run `npm test` and `npm run package`.
3. Upload the `.vsix` from the publisher page at https://marketplace.visualstudio.com/manage (**⋯ → Update**), or publish with `vsce publish` using Microsoft Entra ID credentials.
4. Tag the release (`git tag v0.5.0 && git push --tags`).
