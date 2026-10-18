import * as vscode from 'vscode';
import { ColorSettings } from './colors';

export const SECTION = 'statusFlair';

export type Alignment = 'left' | 'right';
export type ColorTarget = 'global' | 'workspace';
export type ItemClickAction = 'none' | 'openSettings' | 'pickColor' | 'openUrl' | 'runCommand' | 'openClaude';
export type ClaudeClickAction = 'openClaude' | 'newConversation' | 'openTerminal' | 'none';

export interface ItemConfig {
  enabled: boolean;
  text: string;
  icon: string;
  tooltip: string;
  alignment: Alignment;
  priority: number;
  clickAction: ItemClickAction;
  clickValue: string;
}

export interface ExtraItemConfig {
  text?: string;
  icon?: string;
  tooltip?: string;
  alignment?: Alignment;
  priority?: number;
  url?: string;
  command?: string;
  args?: unknown[];
}

export interface ClaudeConfig {
  enabled: boolean;
  text: string;
  alignment: Alignment;
  priority: number;
  clickAction: ClaudeClickAction;
  colorizeStatusBar: boolean;
  colors: { working: string; waiting: string; done: string; error: string };
  notify: 'off' | 'waiting' | 'all';
  doneTimeoutMs: number;
  staleTimeoutMs: number;
  sessionMaxAgeMs: number;
  usageWarningThreshold: number;
  contextWarningThreshold: number;
  inbox: boolean;
  lens: boolean;
  configDir: string;
}

function section(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export function toAlignment(a: Alignment | undefined): vscode.StatusBarAlignment {
  return a === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
}

export function readItem(): ItemConfig {
  const c = section();
  return {
    enabled: c.get('item.enabled', true),
    text: c.get('item.text', ''),
    icon: c.get('item.icon', ''),
    tooltip: c.get('item.tooltip', ''),
    alignment: c.get('item.alignment', 'left'),
    priority: c.get('item.priority', 10000),
    clickAction: c.get('item.clickAction', 'pickColor'),
    clickValue: c.get('item.clickValue', ''),
  };
}

export function readExtraItems(): ExtraItemConfig[] {
  const items = section().get<unknown>('extraItems', []);
  return Array.isArray(items) ? items.filter((i): i is ExtraItemConfig => !!i && typeof i === 'object') : [];
}

export function readColors(): ColorSettings {
  const c = section();
  return {
    background: c.get('colors.background', ''),
    foreground: c.get('colors.foreground', ''),
    noFolderBackground: c.get('colors.noFolderBackground', ''),
    debuggingBackground: c.get('colors.debuggingBackground', ''),
    debuggingForeground: c.get('colors.debuggingForeground', ''),
    remoteBackground: c.get('colors.remoteBackground', ''),
    remoteForeground: c.get('colors.remoteForeground', ''),
  };
}

export const COLOR_SETTING_KEYS = [
  'colors.target',
  'colors.background',
  'colors.foreground',
  'colors.noFolderBackground',
  'colors.debuggingBackground',
  'colors.debuggingForeground',
  'colors.remoteBackground',
  'colors.remoteForeground',
];

export function hasWorkspace(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

/** The configured target, falling back to global when no folder is open. */
export function readColorTarget(): ColorTarget {
  const target = section().get<ColorTarget>('colors.target', 'global');
  return target === 'workspace' && hasWorkspace() ? 'workspace' : 'global';
}

export function readClaude(): ClaudeConfig {
  const c = section();
  return {
    enabled: c.get('claude.enabled', true),
    text: c.get('claude.text', ''),
    alignment: c.get('claude.alignment', 'right'),
    priority: c.get('claude.priority', 1000),
    clickAction: c.get('claude.clickAction', 'openClaude'),
    colorizeStatusBar: c.get('claude.colorizeStatusBar', false),
    colors: {
      working: c.get('claude.colors.working', '#1f6feb'),
      waiting: c.get('claude.colors.waiting', '#d29922'),
      done: c.get('claude.colors.done', '#2ea043'),
      error: c.get('claude.colors.error', '#cf222e'),
    },
    notify: c.get('claude.notify', 'all'),
    doneTimeoutMs: c.get('claude.doneTimeout', 20) * 1000,
    staleTimeoutMs: c.get('claude.staleTimeout', 15) * 60_000,
    sessionMaxAgeMs: c.get('claude.sessionMaxAge', 12) * 3_600_000,
    usageWarningThreshold: c.get('claude.usageWarningThreshold', 80),
    contextWarningThreshold: c.get('claude.contextWarningThreshold', 70),
    inbox: c.get('claude.inbox', true),
    lens: c.get('claude.lens', true),
    configDir: c.get('claude.configDir', ''),
  };
}

export interface GitHubConfig {
  enabled: boolean;
  alignment: Alignment;
  priority: number;
}

export function readGitHub(): GitHubConfig {
  const c = section();
  return {
    enabled: c.get('github.enabled', true),
    alignment: c.get('github.alignment', 'left'),
    priority: c.get('github.priority', 9998),
  };
}

export interface WorktreesConfig {
  enabled: boolean;
  alignment: Alignment;
  priority: number;
  location: string;
  base: string;
  openIn: 'newWindow' | 'currentWindow';
  copyFiles: string[];
  staleDays: number;
  autoColor: boolean;
}

export function readWorktrees(): WorktreesConfig {
  const c = section();
  const copyFiles = c.get<unknown>('worktrees.copyFiles', []);
  return {
    enabled: c.get('worktrees.enabled', true),
    alignment: c.get('worktrees.alignment', 'left'),
    priority: c.get('worktrees.priority', 9999),
    location: c.get('worktrees.location', '${repoRoot}/.claude/worktrees/${branchSlug}'),
    base: c.get('worktrees.base', ''),
    openIn: c.get('worktrees.openIn', 'newWindow'),
    copyFiles: Array.isArray(copyFiles) ? copyFiles.filter((f): f is string => typeof f === 'string' && !!f.trim()) : [],
    staleDays: c.get('worktrees.staleDays', 14),
    autoColor: c.get('worktrees.autoColor', false),
  };
}

export async function updateSetting(key: string, value: unknown, target: ColorTarget): Promise<void> {
  const scope = target === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await section().update(key, value, scope);
}
