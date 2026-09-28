import { spawn } from 'node:child_process';
import path from 'node:path';
import { ensure } from './manager.mjs';

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) {
  process.stderr.write('用法: node open.mjs <项目根绝对路径>\n');
  process.exitCode = 1;
} else {
  try {
    await ensure({ root });
    const url = new URL('http://127.0.0.1:' + (process.env.AGENT_KANBAN_PORT || '4731') + '/');
    url.searchParams.set('root', root);
    if (process.env.AGENT_KANBAN_OPEN_DRY_RUN !== '1') {
      if (process.platform !== 'win32') throw new Error('本版打开脚本仅支持 Windows');
      // CMD expands %3A and %5C in encoded URLs as positional parameters.
      // Pass the URL via the environment instead of interpolating it into shell source.
      const child = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:AGENT_KANBAN_OPEN_URL',
      ], {
        windowsHide: true, stdio: 'ignore', cwd: process.env.TEMP || process.env.TMP || '.',
        env: { ...process.env, AGENT_KANBAN_OPEN_URL: url.toString() },
      });
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      if (code !== 0) throw new Error(`默认浏览器启动失败 (exit ${code})`);
    }
    process.stdout.write(url.toString() + '\n');
  } catch (error) {
    process.stderr.write(`kanban-viewer: ${error.message}\n`);
    process.exitCode = 1;
  }
}
