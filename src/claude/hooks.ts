import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  addHooks,
  ClaudeSettings,
  hasStatusFlairHooks,
  hookCommand,
  installStatusLine,
  isOurStatusLine,
  removeHooks,
  restoreStatusLine,
  StatusLine,
} from './hooksConfig';
import { hookDir, hookScript, settingsFile, statusLineBackup, statusLineScript } from './paths';

export interface IntegrationStatus {
  hooks: boolean;
  statusLine: boolean;
  /** The current status line command, to notice when another tool replaces it. */
  statusLineCommand?: string;
}

async function readSettings(configDir: string): Promise<ClaudeSettings> {
  let text: string;
  try {
    text = await fs.readFile(settingsFile(configDir), 'utf8');
  } catch {
    return {};
  }
  text = text.replace(/^﻿/, '');
  if (!text.trim()) {
    return {};
  }
  // Throws on invalid JSON on purpose: never overwrite a file we could not read.
  return JSON.parse(text) as ClaudeSettings;
}

async function writeSettings(configDir: string, settings: ClaudeSettings): Promise<void> {
  const file = settingsFile(configDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.copyFile(file, `${file}.status-flair.bak`).catch(() => undefined);
  await fs.writeFile(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

async function readStatusLineBackup(configDir: string): Promise<StatusLine | null> {
  try {
    return (JSON.parse(await fs.readFile(statusLineBackup(configDir), 'utf8')) as { statusLine: StatusLine | null }).statusLine;
  } catch {
    return null;
  }
}

export async function integrationStatus(configDir: string): Promise<IntegrationStatus> {
  try {
    const settings = await readSettings(configDir);
    return {
      hooks: hasStatusFlairHooks(settings),
      statusLine: isOurStatusLine(settings.statusLine),
      statusLineCommand: settings.statusLine?.command,
    };
  } catch {
    return { hooks: false, statusLine: false };
  }
}

/** Copies the bundled scripts next to Claude's config so their paths survive extension updates. */
export async function copyScripts(context: vscode.ExtensionContext, configDir: string): Promise<void> {
  await fs.mkdir(hookDir(configDir), { recursive: true });
  await fs.copyFile(context.asAbsolutePath(path.join('resources', 'claude-hook.js')), hookScript(configDir));
  await fs.copyFile(context.asAbsolutePath(path.join('resources', 'claude-statusline.js')), statusLineScript(configDir));
}

function nodeAvailable(): Promise<boolean> {
  return new Promise((resolve) => execFile('node', ['--version'], { timeout: 5000 }, (err) => resolve(!err)));
}

export async function installIntegration(context: vscode.ExtensionContext, configDir: string): Promise<boolean> {
  let settings: ClaudeSettings;
  try {
    settings = await readSettings(configDir);
  } catch (err: any) {
    void vscode.window.showErrorMessage(`Could not read ${settingsFile(configDir)}: ${err?.message ?? err}`);
    return false;
  }
  const wrapping = settings.statusLine && !isOurStatusLine(settings.statusLine);

  const choice = await vscode.window.showInformationMessage(
    'Install the Status Flair integration into Claude Code?',
    {
      modal: true,
      detail: [
        `This edits ${settingsFile(configDir)} (a backup is saved next to it):`,
        '',
        '• Hooks that record whether Claude is working, waiting for you, or done.',
        '• A status line recorder that saves your plan limits, context and cost after each response.',
        wrapping
          ? '  Your current status line is kept: it receives the same input and its output is unchanged. Uninstalling restores it exactly.'
          : '',
        '',
        'Both only write small files under the status-flair folder; they print nothing and never change what Claude does.',
      ]
        .filter((line, i, all) => line || all[i - 1])
        .join('\n'),
    },
    'Install',
  );
  if (choice !== 'Install') {
    return false;
  }
  if (!(await nodeAvailable())) {
    const go = await vscode.window.showWarningMessage(
      'Node.js was not found on your PATH. Claude Code runs the scripts with `node`, so nothing will update until Node.js is installed.',
      'Install anyway',
    );
    if (go !== 'Install anyway') {
      return false;
    }
  }

  try {
    await copyScripts(context, configDir);
    let original: StatusLine | null;
    if (isOurStatusLine(settings.statusLine)) {
      original = await readStatusLineBackup(configDir);
    } else {
      original = settings.statusLine ?? null;
      await fs.writeFile(statusLineBackup(configDir), JSON.stringify({ statusLine: original }, null, 2), 'utf8');
    }
    const next = installStatusLine(addHooks(settings, hookCommand(hookScript(configDir))), statusLineScript(configDir), original);
    await writeSettings(configDir, next);
  } catch (err: any) {
    void vscode.window.showErrorMessage(`Could not install the integration: ${err?.message ?? err}`);
    return false;
  }
  void vscode.window.showInformationMessage(
    'Status Flair is connected to Claude Code. Sessions started from now on will report their state and usage.',
  );
  return true;
}

export async function uninstallIntegration(configDir: string): Promise<void> {
  try {
    const settings = await readSettings(configDir);
    if (!hasStatusFlairHooks(settings) && !isOurStatusLine(settings.statusLine)) {
      void vscode.window.showInformationMessage('The Status Flair integration is not installed in Claude Code.');
      return;
    }
    const original = await readStatusLineBackup(configDir);
    await writeSettings(configDir, restoreStatusLine(removeHooks(settings), original));
    await fs.rm(hookDir(configDir), { recursive: true, force: true });
    void vscode.window.showInformationMessage('Status Flair integration removed from Claude Code.');
  } catch (err: any) {
    void vscode.window.showErrorMessage(`Could not remove the integration: ${err?.message ?? err}`);
  }
}
