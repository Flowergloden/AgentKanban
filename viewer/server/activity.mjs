import { promises as fs } from 'node:fs';
import path from 'node:path';
import { registryPaths } from './registry.mjs';
import { ensure, probe } from './manager.mjs';

const base = 'http://127.0.0.1:' + (process.env.AGENT_KANBAN_PORT || '4731');
const throttleFile = path.join(registryPaths().dataDir, 'activity-hook.json');
const THROTTLE_MS = 45_000;

export function isDiagnosticOrControl(event) {
  if (event.hook_event_name !== 'PostToolUse') return false;
  const input = event.tool_input;
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? {});
  return /(?:control\.mjs|\/api\/(?:health|service\/(?:status|mode)|shutdown))(?:\b|[?"'\s])/i.test(text) ||
    /(?:heartbeat\.mjs|ensure\.mjs|codex-hook\.mjs)/i.test(text);
}

export async function reportActivity(event) {
  if (isDiagnosticOrControl(event)) return { skipped: 'control' };
  const root = typeof event.cwd === 'string' && event.cwd ? event.cwd : undefined;
  if (!root) return { skipped: 'no-root' };
  const current = await probe();
  if (!current) {
    await ensure({ root });
    return { recovered: true };
  }
  // On an occupied or incompatible port, ensure produces the actionable diagnostic.
  if (current.data?.name !== 'kanban-viewer' || current.data?.ok !== true) {
    await ensure({ root });
    return { skipped: 'incompatible' };
  }
  let previous = 0;
  try { previous = JSON.parse(await fs.readFile(throttleFile, 'utf8')).at; }
  catch { /* first activity */ }
  if (Number.isFinite(previous) && Date.now() - previous < THROTTLE_MS) return { skipped: 'throttled' };
  const endpoint = current.data.protocolVersion === undefined ? '/api/heartbeat' : '/api/activity';
  const result = await fetch(base + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root }),
    signal: AbortSignal.timeout(2000),
  });
  if (!result.ok) throw new Error(`活动上报失败 (${result.status})`);
  await fs.mkdir(path.dirname(throttleFile), { recursive: true });
  await fs.writeFile(throttleFile, JSON.stringify({ at: Date.now() }));
  return { renewed: true };
}
