import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  ClaudeSettings,
  installStatusLine,
  isOurStatusLine,
  restoreStatusLine,
  statusLineCommand,
  StatusLine,
} from '../claude/hooksConfig';

const orca: StatusLine = { type: 'command', command: 'if [ -n "$X" ]; then exit 0; fi; cat >/dev/null', padding: 1 };

describe('status line settings', () => {
  it('wraps the existing status line and keeps its options', () => {
    const next = installStatusLine({ model: 'opus', statusLine: orca }, '/h/status-flair/statusline.js', orca);
    assert.ok(isOurStatusLine(next.statusLine));
    assert.equal(next.statusLine?.padding, 1);
    assert.ok(next.statusLine?.command?.includes(orca.command!));
    assert.equal(next.model, 'opus');
  });

  it('uses the recorder alone when there was no status line', () => {
    const next = installStatusLine({}, 'C:\\h\\status-flair\\statusline.js', null);
    assert.equal(next.statusLine?.command, 'node "C:/h/status-flair/statusline.js"');
  });

  it('restores exactly what was there', () => {
    const settings: ClaudeSettings = { statusLine: orca };
    assert.deepEqual(restoreStatusLine(installStatusLine(settings, '/s/status-flair/statusline.js', orca), orca), settings);
    assert.deepEqual(restoreStatusLine(installStatusLine({}, '/s/status-flair/statusline.js', null), null), {});
  });

  it('leaves a status line another tool installed afterwards alone', () => {
    assert.deepEqual(restoreStatusLine({ statusLine: orca }, null), { statusLine: orca });
  });
});

// Runs the generated command in a real POSIX shell, the way Claude Code does.
function findShell(): string | undefined {
  const candidates =
    process.platform === 'win32'
      ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']
      : ['/bin/sh'];
  return candidates.find((c) => fs.existsSync(c));
}

describe('wrapped status line command', { skip: !findShell() && 'no POSIX shell found' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-flair-sl-'));
  const script = path.join(dir, 'status-flair', 'statusline.js');
  fs.mkdirSync(path.dirname(script));
  fs.copyFileSync(path.join(__dirname, '..', '..', 'resources', 'claude-statusline.js'), script);
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const input = JSON.stringify({
    session_id: 'sess-1',
    cwd: '/app',
    workspace: { current_dir: '/app/sub' },
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    rate_limits: { five_hour: { used_percentage: 41.5, resets_at: 1800000000 }, seven_day: { used_percentage: 15, resets_at: 1800500000 } },
    context_window: { used_percentage: 16, context_window_size: 1000000, total_input_tokens: 5 },
    cost: { total_cost_usd: 4.12, total_duration_ms: 1 },
  });
  const run = (command: string) => spawnSync(findShell()!, ['-c', command], { input, encoding: 'utf8' });

  it('keeps the original output and records the usage', () => {
    const original = `read -r line; printf 'ORIGINAL:%s' "$(printf '%s' "$line" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).model.display_name))')"`;
    const result = run(statusLineCommand(script, original));
    assert.equal(result.stdout, 'ORIGINAL:Opus 5.5');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'status-flair', 'usage', 'sess-1.json'), 'utf8'));
    assert.equal(saved.cwd, '/app/sub');
    assert.deepEqual(saved.rate_limits.five_hour, { used_percentage: 41.5, resets_at: 1800000000 });
    assert.deepEqual(saved.context_window, { used_percentage: 16, context_window_size: 1000000 });
    assert.deepEqual(saved.cost, { total_cost_usd: 4.12 });
  });

  it('keeps the original exit-0 early returns working', () => {
    const result = run(statusLineCommand(script, 'if true; then exit 0; fi; echo never'));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('prints nothing on its own', () => {
    assert.equal(run(statusLineCommand(script)).stdout, '');
    assert.equal(execFileSync(process.execPath, [script], { input: 'garbage', encoding: 'utf8' }), '');
  });
});
