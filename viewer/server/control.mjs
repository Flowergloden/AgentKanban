import { ensure, control } from './manager.mjs';

const [action, ...args] = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex === -1 ? undefined : args[rootIndex + 1];
try {
  if (rootIndex >= 0 && (!root || root.startsWith('--'))) throw new Error('--root 需要明确的项目路径');
  if (rootIndex >= 0) args.splice(rootIndex, 2);
  let result;
  if (action === 'start') {
    if (args.some((arg) => arg !== '--persistent') || args.filter((arg) => arg === '--persistent').length > 1)
      throw new Error('用法: start [--persistent] [--root <path>]');
    result = { running: true, ...await ensure({ root, persistent: args.includes('--persistent') }) };
  } else if (['auto', 'status', 'stop'].includes(action) && args.length === 0 && !root) {
    result = await control(action);
  } else throw new Error('用法: start [--persistent] [--root <path>] | auto | status | stop');
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write(`kanban-viewer: ${error.message}\n`);
  process.exitCode = 1;
}
