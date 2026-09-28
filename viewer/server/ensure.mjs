import { ensure } from './manager.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let root;
try { root = JSON.parse(input).cwd; } catch { /* no explicit project root */ }
try {
  const result = await ensure({ root: typeof root === 'string' && root ? root : undefined });
  if (result.legacy) process.stderr.write('kanban-viewer: 旧协议普通功能降级复用，请升级 Kimi 和 Codex 插件\n');
} catch (error) {
  process.stderr.write(`kanban-viewer: ${error.message}\n`);
  process.exitCode = 1;
}
