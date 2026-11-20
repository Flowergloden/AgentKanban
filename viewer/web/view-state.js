export const TABLE_VIEW = Object.freeze({ kind: 'table' });

// 与服务端默认 schema 一致的兜底视图：schema 尚未加载或来自旧服务时保持页面可用
const FALLBACK_VIEWS = Object.freeze([
  Object.freeze({ key: 'all', label: '全部字段', kind: 'table' }),
  Object.freeze({ key: 'status-board', label: '状态看板', kind: 'board', fieldKey: 'status' }),
  Object.freeze({ key: 'dependency-graph', label: '依赖关系', kind: 'graph', fieldKey: 'dependencies' }),
]);

// 视图入口只来自 schema.views 配置（key、label、顺序、字段绑定），不为字段类型自动派生
function configuredViews(schema) {
  return Array.isArray(schema?.views) && schema.views.length > 0 ? schema.views : FALLBACK_VIEWS;
}

export function viewsForSchema(schema) {
  return configuredViews(schema).map((view) => ({
    key: view.key,
    label: view.label,
    kind: view.kind,
    ...(view.fieldKey !== undefined ? { fieldKey: view.fieldKey } : {}),
  }));
}

// 有效性同时核对配置项与字段绑定：入口存在于 views 配置，且 board/graph 绑定字段仍存在且类型匹配
export function isViewValid(view, schema) {
  if (!view || !schema) return false;
  const entry = configuredViews(schema).find((item) => item.kind === view.kind && (item.kind === 'table' || item.fieldKey === view.fieldKey));
  if (!entry) return false;
  if (view.kind === 'table') return true;
  const field = schema.fields?.find((item) => item.key === view.fieldKey);
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
