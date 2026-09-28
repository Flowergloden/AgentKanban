import { readFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensure } from './manager.mjs';
import { reportActivity } from './activity.mjs';

let raw = '';
for await (const part of process.stdin) raw += part;
let event = {};
try { event = JSON.parse(raw); } catch { /* do not trust malformed hook data */ }
const root = typeof event.cwd === 'string' && event.cwd ? event.cwd : undefined;

if (process.argv[2] === 'start') {
  // Independent of service availability: never swallow the session convention.
  const system = readFileSync(fileURLToPath(new URL('../SYSTEM.md', import.meta.url)), 'utf8');
  try {
    if (root && ['startup', 'resume'].includes(event.source)) await ensure({ root });
  } catch (error) { process.stderr.write(`kanban-viewer: ${error.message}\n`); }
  writeSync(1, JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: system } }) + '\n');
} else if (process.argv[2] === 'activity') {
  try { await reportActivity(event); }
  catch (error) { process.stderr.write('kanban-viewer: ' + error.message + '\n'); }
}
