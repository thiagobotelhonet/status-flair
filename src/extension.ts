import * as vscode from 'vscode';
import { ClaudeController } from './claude/controller';
import { ColorManager } from './colorManager';
import { applyRandomColor, pickColor } from './colorPicker';
import { buildColorCustomizations, ColorMap, stateOverride } from './colors';
import {
  COLOR_SETTING_KEYS,
  hasWorkspace,
  readClaude,
  readColors,
  readColorTarget,
  readItem,
  SECTION,
  updateSetting,
} from './config';
import { startContextVariables } from './contextVariables';
import { ITEM_CLICK_COMMAND, ItemsManager } from './items';
import { Variables } from './variables';
import { WorktreeController } from './worktrees/controller';
import { InboxController } from './claude/inbox';
import { LensController } from './claude/lens';
import { GitHubController } from './github/controller';

export function activate(context: vscode.ExtensionContext): void {
  const vars = new Variables();
  const items = new ItemsManager(vars);
  const colors = new ColorManager(context);
  const claude = new ClaudeController(context, vars);
  const inbox = new InboxController(claude);
  const lens = new LensController(claude);
  const github = new GitHubController(vars);
  const worktrees = new WorktreeController(context, vars, claude, github);
  claude.excludedFolders = () => worktrees.nestedWorktrees();
  let preview: string | undefined;

  const refreshColors = () => {
    const settings = readColors();
    const base = buildColorCustomizations({ ...settings, ...(preview !== undefined && { background: preview }) });
    const claudeConfig = readClaude();
    const state = claude.state;
    const claudeColors: ColorMap =
      claudeConfig.enabled && claudeConfig.colorizeStatusBar && state !== 'idle'
        ? stateOverride(claudeConfig.colors[state])
        : {};
    const target = readColorTarget();
    // A worktree's automatic color yields to a color picked for that workspace.
    const pickedHere = vscode.workspace.getConfiguration(SECTION).inspect<string>('colors.background')?.workspaceValue;
    const worktreeColors =
      worktrees.autoColor && !pickedHere && preview === undefined
        ? buildColorCustomizations({ ...settings, background: worktrees.autoColor })
        : undefined;
    // State colors always go to the workspace so windows of different projects do not fight over user settings.
    return colors.apply({
      global: target === 'global' ? base : {},
      workspace: {
        ...(target === 'workspace' ? base : {}),
        ...worktreeColors,
        ...(hasWorkspace() ? claudeColors : {}),
      },
    });
  };

  const openSettings = () => vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`);
  const picker = {
    preview: (hex: string | undefined) => {
      preview = hex;
      return refreshColors();
    },
  };

  const onItemClick = async () => {
    const { clickAction, clickValue } = readItem();
    switch (clickAction) {
      case 'openSettings':
        return openSettings();
      case 'pickColor':
        return pickColor(picker, 'configured');
      case 'openUrl':
        return clickValue && vscode.env.openExternal(vscode.Uri.parse(clickValue));
      case 'runCommand':
        return clickValue && vscode.commands.executeCommand(clickValue);
      case 'openClaude':
        return claude.open();
      default:
        return undefined;
    }
  };

  const resetColors = async () => {
    for (const key of COLOR_SETTING_KEYS) {
      await updateSetting(key, undefined, 'global');
      if (hasWorkspace()) {
        await updateSetting(key, undefined, 'workspace');
      }
    }
    await colors.apply({ global: {}, workspace: {} });
    void vscode.window.showInformationMessage('Status Flair colors removed. The status bar uses your theme again.');
  };

  context.subscriptions.push(
    vars,
    items,
    claude,
    startContextVariables(vars),
    vscode.commands.registerCommand(ITEM_CLICK_COMMAND, onItemClick),
    vscode.commands.registerCommand('statusFlair.pickColor', () => pickColor(picker, 'configured')),
    vscode.commands.registerCommand('statusFlair.pickWorkspaceColor', () => pickColor(picker, 'workspace')),
    vscode.commands.registerCommand('statusFlair.randomColor', applyRandomColor),
    vscode.commands.registerCommand('statusFlair.resetColors', resetColors),
    vscode.commands.registerCommand('statusFlair.openSettings', openSettings),
    vscode.commands.registerCommand('statusFlair.claude.open', () => claude.open()),
    vscode.commands.registerCommand('statusFlair.claude.installHooks', () => claude.installIntegration()),
    vscode.commands.registerCommand('statusFlair.claude.uninstallHooks', () => claude.uninstallIntegration()),
    inbox,
    lens,
    github,
    vscode.commands.registerCommand('statusFlair.claude.inbox', () => inbox.pick()),
    vscode.commands.registerCommand('statusFlair.lens.show', () => lens.show()),
    vscode.commands.registerCommand('statusFlair.github.openPr', () => github.openPr()),
    worktrees,
    vscode.commands.registerCommand('statusFlair.worktrees.pick', () => worktrees.pick()),
    vscode.commands.registerCommand('statusFlair.worktrees.create', () => worktrees.create()),
    vscode.commands.registerCommand('statusFlair.worktrees.cleanup', () => worktrees.cleanup()),
    worktrees.onDidChangeColor(() => void refreshColors()),
    claude.onDidChangeState(() => {
      if (readClaude().colorizeStatusBar) {
        void refreshColors();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(SECTION)) {
        return;
      }
      if (e.affectsConfiguration(`${SECTION}.item`) || e.affectsConfiguration(`${SECTION}.extraItems`)) {
        items.rebuild();
      }
      if (e.affectsConfiguration(`${SECTION}.claude`)) {
        claude.reload();
        inbox.reload();
        lens.reload();
      }
      if (e.affectsConfiguration(`${SECTION}.github`)) {
        github.reload();
      }
      if (e.affectsConfiguration(`${SECTION}.worktrees`)) {
        worktrees.reload();
      }
      void refreshColors();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshColors()),
  );

  items.rebuild();
  void refreshColors();
}

export function deactivate(): void {}
