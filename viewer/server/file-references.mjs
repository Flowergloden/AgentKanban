import path from 'node:path';
import { getThread } from './threads.mjs';
import { FilePathError, normalizeFilePath, readProjectTextFile, resolveSelectedFile } from './file-paths.mjs';
import { selectFilesWithSystemPicker } from './file-picker.mjs';

export class FileReferenceError extends Error {
  constructor(code, message, status = 400, rejected = []) {
    super(message);
    this.code = code;
    this.status = status;
    this.rejected = rejected;
  }
}

async function requireFileField(root, id, fieldKey) {
  const detail = await getThread(root, id);
  const field = detail.schema.fields.find((item) => item.key === fieldKey);
  if (!field || field.type !== 'file') {
    throw new FileReferenceError('bad-request', `字段不是有效的 file 字段：${fieldKey || '(空)'}`);
  }
  return { detail, field };
}

export async function selectFileReferences(root, id, fieldKey, { picker = selectFilesWithSystemPicker } = {}) {
  await requireFileField(root, id, fieldKey);
  const selected = await picker(root);
  const paths = [];
  const rejected = [];
  for (const candidate of selected) {
    try {
      const resolved = await resolveSelectedFile(root, candidate);
      if (!paths.includes(resolved.path)) paths.push(resolved.path);
    } catch (error) {
      rejected.push({ path: String(candidate), reason: error.message });
    }
  }
  if (rejected.length) {
    throw new FileReferenceError('selection-rejected', '所选文件包含无效目标，本次未添加任何文件', 422, rejected);
  }
  return { paths };
}

function fileErrorStatus(code) {
  if (code === 'not-found') return 404;
  if (code === 'outside-project') return 403;
  if (code === 'invalid-path') return 400;
  if (code === 'read-failed') return 500;
  return 422;
}

export async function readFileReference(root, id, fieldKey, value) {
  const { detail } = await requireFileField(root, id, fieldKey);
  let normalized;
  try {
    normalized = normalizeFilePath(value);
  } catch (error) {
    throw new FileReferenceError(error.code, error.message, 400);
  }
  if (!detail.fields[fieldKey].value.includes(normalized)) {
    throw new FileReferenceError('file-not-registered', '请求路径未登记在该线程的指定 file 字段中', 403);
  }
  try {
    const file = await readProjectTextFile(root, normalized);
    const extension = path.extname(normalized).toLowerCase();
    return {
      path: normalized,
      kind: extension === '.md' || extension === '.markdown' ? 'markdown' : 'text',
      content: file.content,
    };
  } catch (error) {
    if (error instanceof FilePathError) throw new FileReferenceError(error.code, error.message, fileErrorStatus(error.code));
    throw error;
  }
}
