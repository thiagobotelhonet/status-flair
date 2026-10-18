import * as os from 'os';
import * as path from 'path';

export function claudeDir(configured: string): string {
  return configured || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function projectsDir(configured: string): string {
  return path.join(claudeDir(configured), 'projects');
}

export function settingsFile(configured: string): string {
  return path.join(claudeDir(configured), 'settings.json');
}

/** Where the hook script is copied to; it writes its state files to `state/` beside itself. */
export function hookDir(configured: string): string {
  return path.join(claudeDir(configured), 'status-flair');
}

export function hookScript(configured: string): string {
  return path.join(hookDir(configured), 'hook.js');
}

export function stateDir(configured: string): string {
  return path.join(hookDir(configured), 'state');
}

export function statusLineScript(configured: string): string {
  return path.join(hookDir(configured), 'statusline.js');
}

/** The status line that was configured before Status Flair wrapped it. */
export function statusLineBackup(configured: string): string {
  return path.join(hookDir(configured), 'statusline-original.json');
}

export function usageDir(configured: string): string {
  return path.join(hookDir(configured), 'usage');
}
