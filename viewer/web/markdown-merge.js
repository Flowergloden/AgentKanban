import { diff3Merge } from './vendor/diff3.mjs';

// 保留原始换行符的行切分：每行携带其行终止符（\n、\r\n 或 \r），
// 合并后直接连接，避免 CRLF、末尾换行和整文件格式漂移。
export function splitLines(text) {
  const s = String(text ?? '');
  if (!s) return [];
  const lines = [];
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\n') {
      lines.push(s.slice(start, i + 1));
      start = i + 1;
    } else if (s[i] === '\r') {
      if (s[i + 1] === '\n') {
        lines.push(s.slice(start, i + 2));
        start = i + 2;
        i += 1;
      } else {
        lines.push(s.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  if (start < s.length) lines.push(s.slice(start));
  return lines;
}

export function joinLines(lines) {
  return lines.join('');
}

// 三方合并：返回 { content } 或 { conflict: true }。
// 只使用结构化区块，绝不生成或落盘 <<<<<<< / ======= / >>>>>>> 冲突标记；
// 相同修改按非冲突处理（node-diff3 excludeFalseConflicts）。
export function mergeDocuments(base, local, remote) {
  const regions = diff3Merge(splitLines(local), splitLines(base), splitLines(remote));
  if (regions.some((region) => region.conflict)) return { conflict: true };
  return { content: joinLines(regions.flatMap((region) => region.ok)) };
}
