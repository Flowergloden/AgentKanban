import path from 'node:path';
import { open, realpath, stat } from 'node:fs/promises';

export const MAX_FILE_TEXT_BYTES = 1024 * 1024;

export class FilePathError extends Error {
  constructor(code, message, filePath) {
    super(message);
    this.code = code;
    this.path = filePath;
  }
}

export function normalizeFilePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new FilePathError('invalid-path', '文件路径必须是非空字符串', value);
  }
  if (value.includes('\0') || /[\r\n]/.test(value)) {
    throw new FilePathError('invalid-path', '文件路径不能包含 NUL 或换行', value);
  }
  if (/^[\\/]/.test(value) || /^[A-Za-z]:/.test(value)) {
    throw new FilePathError('invalid-path', '文件路径必须是项目相对路径', value);
  }
  if (/[\\/]$/.test(value)) {
    throw new FilePathError('invalid-path', '文件路径不能是目录式路径', value);
  }
  const segments = value.split(/[\\/]+/);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new FilePathError('invalid-path', '文件路径不能包含 . 或 .. 路径段', value);
  }
  return segments.join('/');
}

function containsPath(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function resolveExistingFile(rootPath, candidatePath, displayPath) {
  const lexicalRoot = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  if (!containsPath(lexicalRoot, candidate)) {
    throw new FilePathError('outside-project', '文件实际路径必须位于项目内', displayPath);
  }

  let realRoot;
  let realTarget;
  try {
    [realRoot, realTarget] = await Promise.all([realpath(lexicalRoot), realpath(candidate)]);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new FilePathError('not-found', '文件不存在', displayPath);
    }
    throw new FilePathError('read-failed', `无法解析文件路径：${error.message}`, displayPath);
  }
  if (!containsPath(realRoot, realTarget)) {
    throw new FilePathError('outside-project', '文件实际路径必须位于项目内', displayPath);
  }

  let metadata;
  try {
    metadata = await stat(realTarget);
  } catch (error) {
    throw new FilePathError('read-failed', `无法检查文件：${error.message}`, displayPath);
  }
  if (!metadata.isFile()) {
    throw new FilePathError('not-file', '目标必须是普通文件', displayPath);
  }
  return { rootPath: realRoot, absolutePath: realTarget };
}

export async function resolveProjectFile(rootPath, value) {
  const normalized = normalizeFilePath(value);
  const resolved = await resolveExistingFile(rootPath, path.join(path.resolve(rootPath), ...normalized.split('/')), normalized);
  return { path: normalized, ...resolved };
}

export async function resolveSelectedFile(rootPath, value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !path.isAbsolute(value)) {
    throw new FilePathError('invalid-path', '选择结果必须是有效的绝对路径', value);
  }
  const resolved = await resolveExistingFile(rootPath, value, value);
  const normalized = path.relative(resolved.rootPath, resolved.absolutePath).split(path.sep).join('/');
  return { path: normalizeFilePath(normalized), ...resolved };
}

export async function readProjectTextFile(rootPath, value, { maxBytes = MAX_FILE_TEXT_BYTES } = {}) {
  const resolved = await resolveProjectFile(rootPath, value);
  let handle;
  try {
    handle = await open(resolved.absolutePath, 'r');
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new FilePathError('not-found', '文件不存在', resolved.path);
    }
    throw new FilePathError('read-failed', `无法打开文件：${error.message}`, resolved.path);
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new FilePathError('not-file', '目标必须是普通文件', resolved.path);
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    if (bytesRead > maxBytes) throw new FilePathError('too-large', `文件超过 ${maxBytes} 字节文本预览上限`, resolved.path);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) throw new FilePathError('nul-content', '文件包含 NUL，不能按文本预览', resolved.path);
    let content;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new FilePathError('invalid-utf8', '文件不是有效 UTF-8 文本', resolved.path);
    }
    return { ...resolved, content, size: bytesRead };
  } catch (error) {
    if (error instanceof FilePathError) throw error;
    throw new FilePathError('read-failed', `无法读取文件：${error.message}`, resolved.path);
  } finally {
    await handle.close();
  }
}
