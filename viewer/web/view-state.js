export const TABLE_VIEW = Object.freeze({ kind: 'table' });

export function viewsForSchema(schema) {
  const views = [{ ...TABLE_VIEW, key: 'table', label: '全部字段' }];
  for (const field of schema?.fields ?? []) {
    if (field.type === 'select') views.push({ kind: 'board', fieldKey: field.key, key: `board:${field.key}`, label: `看板：${field.label}` });
    if (field.type === 'reference') views.push({ kind: 'graph', fieldKey: field.key, key: `graph:${field.key}`, label: `引用图：${field.label}` });
  }
  return views;
}

export function isViewValid(view, schema) {
  if (!view || view.kind === 'table') return true;
  const field = schema?.fields?.find((item) => item.key === view.fieldKey);
  return Boolean(field && ((view.kind === 'board' && field.type === 'select') || (view.kind === 'graph' && field.type === 'reference')));
}

export function listProjection(data) {
  return JSON.stringify({
    schemaFingerprint: data?.schemaFingerprint ?? '',
    threads: (data?.threads ?? []).map((thread) => ({
      id: thread.id,
      title: thread.title,
      status: thread.status,
      mtimeMs: thread.mtimeMs,
      active: thread.active,
      error: thread.error,
      fingerprint: thread.fingerprint,
      fields: thread.fields,
    })),
  });
}
