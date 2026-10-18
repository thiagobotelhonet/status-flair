#!/usr/bin/env node
// Status Flair status line recorder for Claude Code.
// Claude Code pipes its documented status line JSON here after each response. This script
// saves plan limits, context and cost to ./usage/<session>.json next to itself and prints
// nothing: any status line you already had keeps rendering exactly as before.
'use strict';

const fs = require('fs');
const path = require('path');

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  const out = {};
  for (const key of keys) {
    if (obj[key] !== undefined) {
      out[key] = obj[key];
    }
  }
  return out;
}

function run(input) {
  const data = JSON.parse(input);
  const sessionId = String(data.session_id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sessionId) {
    return;
  }
  const record = {
    sessionId,
    cwd: (data.workspace && data.workspace.current_dir) || data.cwd || '',
    ts: Date.now(),
    model: pick(data.model, ['id', 'display_name']),
    rate_limits: data.rate_limits
      ? {
          five_hour: pick(data.rate_limits.five_hour, ['used_percentage', 'resets_at']),
          seven_day: pick(data.rate_limits.seven_day, ['used_percentage', 'resets_at']),
        }
      : undefined,
    context_window: pick(data.context_window, ['used_percentage', 'context_window_size']),
    cost: pick(data.cost, ['total_cost_usd']),
  };
  const dir = path.join(__dirname, 'usage');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, sessionId + '.json');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record));
  fs.renameSync(tmp, file);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    run(input);
  } catch {
    // Never disturb the status line.
  }
  process.exit(0);
});
setTimeout(() => process.exit(0), 3000).unref();
