import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const pickerScript = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
[Console]::OutputEncoding = $utf8
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Multiselect = $true
$dialog.CheckFileExists = $true
$dialog.CheckPathExists = $true
$dialog.InitialDirectory = $env:AGENT_KANBAN_FILE_ROOT
$dialog.Title = '选择项目文件'
try {
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $json = ConvertTo-Json -InputObject @($dialog.FileNames) -Compress
  } else {
    $json = '[]'
  }
  [Console]::Out.Write($json)
} finally {
  $dialog.Dispose()
}
`;

export class FilePickerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = 500;
  }
}

async function runPickerProcess({ rootPath, script, maxOutputBytes }) {
  if (process.env.AGENT_KANBAN_FILE_PICKER_FIXTURE) {
    const fixture = JSON.parse(await readFile(process.env.AGENT_KANBAN_FILE_PICKER_FIXTURE, 'utf8'));
    if (fixture.delayMs) await delay(fixture.delayMs);
    if (fixture.error) throw new FilePickerError(fixture.error.code || 'picker-process', fixture.error.message);
    return { stdout: fixture.stdout ?? JSON.stringify(fixture.paths || []), stderr: '' };
  }
  if (process.platform !== 'win32') throw new FilePickerError('picker-unsupported', '系统文件选择器仅支持 Windows');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AGENT_KANBAN_FILE_ROOT: path.resolve(rootPath) },
    });
    const stdout = [];
    let outputBytes = 0;
    let stderrText = '';
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.on('error', (error) => fail(new FilePickerError('picker-spawn', `无法启动系统文件选择器：${error.message}`)));
    child.stderr.on('data', (chunk) => {
      stderrText = (stderrText + chunk.toString('utf8')).slice(-64 * 1024);
    });
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        fail(new FilePickerError('picker-output-too-large', '系统文件选择器输出超过大小限制'));
        return;
      }
      stdout.push(chunk);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new FilePickerError('picker-exit', `系统文件选择器异常退出（${code}）：${stderrText.trim() || '无错误输出'}`));
        return;
      }
      resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: stderrText });
    });
  });
}

export async function selectFilesWithSystemPicker(rootPath, { runner = runPickerProcess, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES } = {}) {
  let result;
  try {
    result = await runner({ rootPath, script: pickerScript, maxOutputBytes });
  } catch (error) {
    if (error instanceof FilePickerError) throw error;
    throw new FilePickerError('picker-process', `系统文件选择器执行失败：${error.message}`);
  }
  const stdout = String(result?.stdout ?? '');
  if (Buffer.byteLength(stdout, 'utf8') > maxOutputBytes) {
    throw new FilePickerError('picker-output-too-large', '系统文件选择器输出超过大小限制');
  }
  let paths;
  try {
    paths = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  } catch (error) {
    throw new FilePickerError('picker-output', `系统文件选择器返回异常 JSON：${error.message}`);
  }
  if (!Array.isArray(paths) || paths.some((filePath) => typeof filePath !== 'string')) {
    throw new FilePickerError('picker-output', '系统文件选择器必须返回路径字符串数组');
  }
  return paths;
}
