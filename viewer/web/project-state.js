// 项目状态投影与选择的纯逻辑（app.js 渲染与 node --test 共用，不依赖 DOM/网络）

// 历史 URL 可能带 "\" 或尾斜杠：归一化为 "/" 形式；盘符根保留尾部斜杠
export function normalizeUrlRoot(value) {
  let norm = String(value || '').trim().replace(/\\/g, '/');
  norm = norm.replace(/\/+$/, '');
  if (/^[a-zA-Z]:$/.test(norm)) norm += '/';
  return norm;
}

// 比对键：服务端注册表在 Windows 下使用大小写折叠后的规范键
export function rootKey(value) {
  return normalizeUrlRoot(value).toLowerCase();
}

export function findProject(list, root) {
  const key = rootKey(root);
  if (!key) return null;
  return (Array.isArray(list) ? list : []).find((p) => p && rootKey(p.root) === key) || null;
}

// 主项目选择器只展示已注册项目；服务已按 lastSeen 降序返回，保持相对顺序
export function registeredProjects(list) {
  return (Array.isArray(list) ? list : []).filter((p) => p && p.state === 'registered');
}

export function pickRecentRegistered(list) {
  return registeredProjects(list)[0]?.root || '';
}

// 删除/忽略当前项目后的下一落点：最近的其他已注册项目；没有则空串（空状态）
export function nextRootAfterRemoval(list, removedRoot) {
  const key = rootKey(removedRoot);
  return registeredProjects(list).find((p) => rootKey(p.root) !== key)?.root || '';
}
