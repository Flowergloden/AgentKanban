async function request(path, options = {}) {
  const res = await fetch(path, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const q = (root) => `?root=${encodeURIComponent(root)}`;

export const api = {
  listProjects: () => request('/api/projects'),
  health: () => request('/api/health'),
  activity: (root) => request('/api/activity', jsonOptions('POST', root ? { root } : {})),
  setMode: (mode) => request('/api/service/mode', jsonOptions('POST', { mode })),
  stop: () => request('/api/shutdown', { method: 'POST' }),
  init: (root) => request('/api/init', jsonOptions('POST', { root })),
  listThreads: (root) => request(`/api/threads${q(root)}`),
  getThread: (root, id) => request(`/api/thread${q(root)}&id=${encodeURIComponent(id)}`),
  updateSection: (root, id, section, content, fingerprint) =>
    request('/api/thread/section', jsonOptions('PUT', { root, id, section, content, fingerprint })),
  setStatus: (root, id, status) =>
    request('/api/thread/status', jsonOptions('POST', { root, id, status })),
  getNote: (root) => request(`/api/note${q(root)}`),
  updateNote: (root, content, fingerprint) =>
    request('/api/note', jsonOptions('PUT', { root, content, fingerprint })),
  createThread: (root, title, slug, goal) =>
    request('/api/threads', jsonOptions('POST', { root, title, slug: slug || undefined, goal: goal || undefined })),
  vcsAdd: (root, files) =>
    request('/api/vcs/add', jsonOptions('POST', { root, files })),
  deleteThread: (root, id) =>
    request('/api/thread', jsonOptions('DELETE', { root, id })),
  setActive: (root, id) =>
    request('/api/active-thread', jsonOptions('POST', { root, id })),
};
