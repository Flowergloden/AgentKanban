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
  listThreads: (root) => request(`/api/threads${q(root)}`),
  getThread: (root, id) => request(`/api/thread${q(root)}&id=${encodeURIComponent(id)}`),
  updateSection: (root, id, section, content, fingerprint) =>
    request('/api/thread/section', jsonOptions('PUT', { root, id, section, content, fingerprint })),
  setStatus: (root, id, status) =>
    request('/api/thread/status', jsonOptions('POST', { root, id, status })),
  createThread: (root, title, slug) =>
    request('/api/threads', jsonOptions('POST', { root, title, slug: slug || undefined })),
  deleteThread: (root, id) =>
    request('/api/thread', jsonOptions('DELETE', { root, id })),
  setActive: (root, id) =>
    request('/api/active-thread', jsonOptions('POST', { root, id })),
};
