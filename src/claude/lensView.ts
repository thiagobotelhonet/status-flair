// The Claude Lens page: plain HTML, CSS and script drawn from the session JSON posted by the extension.

/** The Lens webview page. Pure, so it can be previewed and tested outside VS Code. */
export function lensDocument(cspSource: string, nonce: string): string {
  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
<div id="app"><div class="empty">Waiting for Claude Code…</div></div>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}

const CSS = `
:root { --muted: var(--vscode-descriptionForeground); --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.25)));
  --blue: var(--vscode-charts-blue, #4daafc); --green: var(--vscode-charts-green, #3fb950); --red: var(--vscode-charts-red, #f4675f); --yellow: var(--vscode-charts-yellow, #e2b93d);
  --mono: var(--vscode-editor-font-family, Consolas, monospace); }
* { box-sizing: border-box; }
body { margin: 0; padding: 10px 12px 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); }
.empty { color: var(--muted); padding: 16px 4px; line-height: 1.5; }
select { width: 100%; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, var(--border)); border-radius: 3px; padding: 4px 6px; font: inherit; margin-bottom: 10px; }
.title { font-weight: 600; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
.link { color: var(--vscode-textLink-foreground); cursor: pointer; font-weight: 400; font-size: 12px; }
.link:hover { text-decoration: underline; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 10px; white-space: nowrap; }
.pill .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.working { color: var(--blue); background: color-mix(in srgb, var(--blue) 15%, transparent); }
.working .dot { animation: pulse 1.6s infinite; }
.waiting { color: var(--yellow); background: color-mix(in srgb, var(--yellow) 16%, transparent); }
.done { color: var(--green); background: color-mix(in srgb, var(--green) 14%, transparent); }
.error { color: var(--red); background: color-mix(in srgb, var(--red) 14%, transparent); }
.idle { color: var(--muted); background: color-mix(in srgb, var(--muted) 14%, transparent); }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.meta { color: var(--muted); font-size: 11.5px; text-align: right; }
.prompt { color: var(--muted); font-style: italic; border-left: 2px solid var(--border); padding-left: 8px; margin: 4px 0 14px; font-size: 12px; overflow-wrap: anywhere; }
.sec { display: flex; justify-content: space-between; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); margin: 14px 0 6px; }
.now { border: 1px solid color-mix(in srgb, var(--blue) 35%, transparent); background: color-mix(in srgb, var(--blue) 7%, transparent); border-radius: 6px; padding: 8px 10px; display: flex; gap: 10px; align-items: center; }
.now.waiting { border-color: color-mix(in srgb, var(--yellow) 45%, transparent); background: color-mix(in srgb, var(--yellow) 8%, transparent); }
.now.done { border-color: color-mix(in srgb, var(--green) 40%, transparent); background: color-mix(in srgb, var(--green) 7%, transparent); }
.now.error { border-color: color-mix(in srgb, var(--red) 40%, transparent); background: color-mix(in srgb, var(--red) 7%, transparent); }
.now .ico { width: 18px; text-align: center; font-size: 14px; }
.now .what { flex: 1; min-width: 0; }
.now .what b { font-weight: 600; }
.now .what .t { color: var(--muted); font-family: var(--mono); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.timer { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--muted); white-space: nowrap; }
.row { display: grid; grid-template-columns: 16px 1fr auto; gap: 6px; align-items: center; padding: 3px 4px; border-radius: 3px; }
.row:hover { background: var(--vscode-list-hoverBackground); }
.row .i { color: var(--muted); text-align: center; }
.row .x { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .x .code { font-family: var(--mono); font-size: 11.5px; color: var(--vscode-textPreformat-foreground, inherit); }
.row .x .note, .row .x .desc { color: var(--muted); margin-left: 6px; }
.row .x .tag { font-size: 10.5px; border: 1px solid var(--border); border-radius: 8px; padding: 0 5px; margin-left: 6px; color: var(--muted); }
.row .d { color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ok { color: var(--green); } .bad { color: var(--red); } .run { color: var(--blue); }
.spin { display: inline-block; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.files { display: flex; flex-wrap: wrap; gap: 6px; }
.file { border: 1px solid var(--border); border-radius: 4px; padding: 2px 7px; font-size: 11.5px; cursor: pointer; background: var(--vscode-badge-background, transparent); color: var(--vscode-badge-foreground, inherit); }
.file:hover { border-color: var(--vscode-focusBorder); }
.file .a { color: var(--green); margin-left: 5px; } .file .r { color: var(--red); margin-left: 3px; }
.foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid var(--border); color: var(--muted); font-size: 11.5px; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.none { color: var(--muted); font-size: 12px; padding: 2px 4px; }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
let offset = 0;
const ICON = { Edit: '✎', MultiEdit: '✎', Write: '✚', NotebookEdit: '✎', Read: '◱', Bash: '❯', PowerShell: '❯', Grep: '⌕', Glob: '⌕',
  WebFetch: '◍', WebSearch: '◍', Agent: '⧉', Task: '⧉', AskUserQuestion: '?', Skill: '✦', ToolSearch: '⚙' };
const CODE = new Set(['Bash', 'PowerShell', 'Grep', 'Glob']);
const STATE = { working: 'Working', waiting: 'Waiting for you', done: 'Done', error: 'Error', idle: 'Idle' };

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'onclick') el.addEventListener('click', v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === undefined || kid === null || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ':' + String(s % 60).padStart(2, '0');
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function clock(ts) { return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
const now = () => Date.now() + offset;
const live = (start) => h('span', { 'data-start': start }, dur(now() - start));

function activityLine(e) {
  return h('span', { class: 'x' },
    e.label ? h('span', { class: CODE.has(e.tool) ? 'code' : '' }, e.label) : h('span', {}, e.verb),
    e.note ? h('span', { class: 'note' }, e.note) : '',
    e.agent ? h('span', { class: 'tag' }, e.agent) : '');
}

function render(msg) {
  offset = msg.now - Date.now();
  const s = msg.session;
  app.replaceChildren();
  if (!s) {
    app.append(h('div', { class: 'empty' }, 'No Claude Code session in the last 24 hours. Start one in any project and its activity shows up here as it happens.'));
    return;
  }
  if (msg.sessions.length > 1) {
    const sel = h('select', { title: 'Session' });
    for (const o of msg.sessions) {
      const opt = h('option', { value: o.id }, (o.here ? '● ' : '') + o.label + ' — ' + STATE[o.state].toLowerCase());
      if (o.id === msg.selected) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener('change', () => vscode.postMessage({ type: 'select', id: sel.value }));
    app.append(sel);
  } else {
    app.append(h('div', { class: 'title' }, s.label));
  }

  const meta = [s.model, s.contextPercent !== undefined && s.contextPercent !== null ? Math.round(s.contextPercent) + '% context' : ''].filter(Boolean).join(' · ');
  app.append(h('div', { class: 'head' },
    h('span', { class: 'pill ' + s.state }, h('span', { class: 'dot' }), STATE[s.state] + ' · ', live(s.state === 'working' && s.turnStart ? s.turnStart : s.since)),
    h('span', { class: 'meta' }, meta, s.here ? '' : h('div', { class: 'link', onclick: () => vscode.postMessage({ type: 'goTo', id: s.id }) }, 'Open window'))));
  if (s.prompt) app.append(h('div', { class: 'prompt' }, '“' + s.prompt + '”'));

  app.append(h('div', { class: 'sec' }, h('span', {}, 'Now')));
  const c = s.current;
  if (c && (s.state === 'working' || s.state === 'waiting')) {
    app.append(h('div', { class: 'now' + (c.waiting ? ' waiting' : '') },
      h('span', { class: 'ico' }, ICON[c.tool] || '•'),
      h('div', { class: 'what' }, h('b', {}, c.waiting ? 'Needs your approval · ' + c.verb : c.verb), c.label ? h('div', { class: 't' }, c.label) : '', c.agent ? h('div', { class: 't' }, 'in ' + c.agent) : ''),
      h('span', { class: 'timer' }, live(c.start))));
  } else {
    const text = { working: 'Thinking…', waiting: 'Waiting for your answer', done: 'Finished ' + clock(s.since), error: 'Stopped with an error ' + clock(s.since), idle: 'Idle' }[s.state];
    app.append(h('div', { class: 'now ' + s.state }, h('span', { class: 'ico' }, { working: '…', waiting: '?', done: '✓', error: '✗', idle: '·' }[s.state]), h('div', { class: 'what' }, h('b', {}, text))));
  }

  if (s.agents.length) {
    const running = s.agents.filter((a) => !a.end).length;
    app.append(h('div', { class: 'sec' }, h('span', {}, 'Subagents'), h('span', {}, running ? running + ' running' : s.agents.length + ' done')));
    for (const a of s.agents) {
      const icon = a.end ? (a.ok === false ? h('span', { class: 'bad' }, '✗') : h('span', { class: 'ok' }, '✓')) : h('span', { class: 'run spin' }, '⟳');
      app.append(h('div', { class: 'row' }, icon,
        h('span', { class: 'x' }, a.type, a.description ? h('span', { class: 'desc' }, a.description) : ''),
        h('span', { class: 'd' }, a.end ? dur(a.end - a.start) : live(a.start))));
    }
  }

  app.append(h('div', { class: 'sec' }, h('span', {}, 'This turn'), h('span', {}, s.timeline.length + (s.timeline.length === 1 ? ' action' : ' actions'))));
  if (!s.timeline.length) app.append(h('div', { class: 'none' }, 'Nothing yet.'));
  for (const e of s.timeline.slice(0, 30)) {
    const right = e.end
      ? h('span', {}, e.ok === false ? h('span', { class: 'bad' }, '✗ ') : CODE.has(e.tool) ? h('span', { class: 'ok' }, '✓ ') : '', e.end - e.start >= 1000 ? dur(e.end - e.start) : clock(e.start))
      : (s.state === 'working' || s.state === 'waiting') ? h('span', { class: 'run' }, live(e.start)) : h('span', {}, clock(e.start));
    app.append(h('div', { class: 'row', title: [e.tool, e.label, e.note].filter(Boolean).join(' · ') }, h('span', { class: 'i' }, ICON[e.tool] || '•'), activityLine(e), h('span', { class: 'd' }, right)));
  }

  if (s.files.length) {
    app.append(h('div', { class: 'sec' }, h('span', {}, 'Files changed'), h('span', {}, String(s.files.length))));
    app.append(h('div', { class: 'files' }, s.files.map((f) => h('span', { class: 'file', title: f.path, onclick: () => vscode.postMessage({ type: 'openFile', path: f.path }) },
      f.label.split('/').pop(),
      f.added ? h('span', { class: 'a' }, '+' + f.added) : '',
      f.removed ? h('span', { class: 'r' }, '−' + f.removed) : ''))));
  }

  const worked = s.workedMs || s.waitedMs ? 'Worked ' + dur(s.workedMs) + ' · waited for you ' + dur(s.waitedMs) : '';
  app.append(h('div', { class: 'foot' }, h('span', {}, worked), s.turnStart ? h('span', {}, 'Turn started ' + clock(s.turnStart)) : ''));
}

setInterval(() => document.querySelectorAll('[data-start]').forEach((el) => (el.textContent = dur(now() - Number(el.dataset.start)))), 1000);
window.addEventListener('message', (ev) => ev.data && ev.data.type === 'update' && render(ev.data));
vscode.postMessage({ type: 'ready' });
`;
