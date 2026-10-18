/** Hook events Status Flair listens to. The hook script decides what each one means. */
export const HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
] as const;

export const HOOK_MARKER = 'status-flair/hook.js';
export const STATUSLINE_MARKER = 'status-flair/statusline.js';

interface HookCommand {
  type: string;
  command?: string;
  timeout?: number;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookCommand[];
}

export interface StatusLine {
  type: string;
  command?: string;
  padding?: number;
  refreshInterval?: number;
  [key: string]: unknown;
}

export type ClaudeSettings = Record<string, unknown> & {
  hooks?: Record<string, HookGroup[]>;
  statusLine?: StatusLine;
};

function isOurs(h: HookCommand): boolean {
  return typeof h.command === 'string' && h.command.replace(/\\/g, '/').includes(HOOK_MARKER);
}

export function hookCommand(scriptPath: string): string {
  return `node "${scriptPath.replace(/\\/g, '/')}"`;
}

export function hasStatusFlairHooks(settings: ClaudeSettings): boolean {
  return Object.values(settings.hooks ?? {}).some((groups) =>
    groups.some((g) => (g.hooks ?? []).some(isOurs)),
  );
}

/** Returns a copy of `settings` without Status Flair's hooks; other hooks are left untouched. */
export function removeHooks(settings: ClaudeSettings): ClaudeSettings {
  if (!settings.hooks) {
    return settings;
  }
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length > 0) {
      hooks[event] = kept;
    }
  }
  const next: ClaudeSettings = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
  }
  return next;
}

export function isOurStatusLine(statusLine: StatusLine | undefined): boolean {
  return typeof statusLine?.command === 'string' && statusLine.command.replace(/\\/g, '/').includes(STATUSLINE_MARKER);
}

/**
 * The status line command: records Claude's JSON, then hands the same JSON to the
 * status line that was there before, so its output is unchanged. Claude Code runs
 * status line commands in a POSIX shell (Git Bash on Windows).
 */
export function statusLineCommand(scriptPath: string, original?: string): string {
  const record = `node "${scriptPath.replace(/\\/g, '/')}"`;
  if (!original?.trim()) {
    return record;
  }
  return (
    `__sf_input=$(cat); printf '%s' "$__sf_input" | ${record} 2>/dev/null; ` +
    `printf '%s' "$__sf_input" | {\n${original}\n}`
  );
}

/** Points the status line at the recorder, wrapping `original` (the user's own status line, if any). */
export function installStatusLine(settings: ClaudeSettings, scriptPath: string, original: StatusLine | null): ClaudeSettings {
  return {
    ...settings,
    statusLine: { ...(original ?? {}), type: 'command', command: statusLineCommand(scriptPath, original?.command) },
  };
}

/** Puts `original` back, but only if the current status line is still ours. */
export function restoreStatusLine(settings: ClaudeSettings, original: StatusLine | null): ClaudeSettings {
  if (!isOurStatusLine(settings.statusLine)) {
    return settings;
  }
  const next: ClaudeSettings = { ...settings };
  if (original) {
    next.statusLine = original;
  } else {
    delete next.statusLine;
  }
  return next;
}

/** Adds one Status Flair hook per event, replacing any previous Status Flair entries. */
export function addHooks(settings: ClaudeSettings, command: string): ClaudeSettings {
  const base = removeHooks(settings);
  const hooks: Record<string, HookGroup[]> = { ...(base.hooks ?? {}) };
  for (const event of HOOK_EVENTS) {
    hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: 'command', command, timeout: 5 }] }];
  }
  return { ...base, hooks };
}
