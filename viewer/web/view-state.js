export const TABLE_VIEW = Object.freeze({ kind: 'table' });

// 与服务端默认 schema 一致的兜底视图：schema 尚未加载或来自旧服务时保持页面可用
const FALLBACK_FIELDS = Object.freeze([
  Object.freeze({ key: 'status', type: 'select' }),
  Object.freeze({ key: 'dependencies', type: 'reference' }),
]);
const FALLBACK_VIEWS = Object.freeze([
  Object.freeze({ key: 'all', label: '全部字段' }),
  Object.freeze({ key: 'status-board', label: '状态看板', fieldKey: 'status' }),
  Object.freeze({ key: 'dependency-graph', label: '依赖关系', fieldKey: 'dependencies' }),
]);

// 视图入口只来自 schema.views 配置（key、label、顺序、字段绑定），kind 由目标字段类型推导
function configuredViews(schema) {
  return Array.isArray(schema?.views) && schema.views.length > 0 ? schema.views : FALLBACK_VIEWS;
}

function viewKind(view, schema) {
  if (view.fieldKey === undefined) return 'table';
  const fields = schema?.fields ?? FALLBACK_FIELDS;
  const type = fields.find((field) => field.key === view.fieldKey)?.type;
  if (type === 'select') return 'board';
  if (type === 'reference') return 'graph';
  return undefined;
}

export function viewsForSchema(schema) {
  return configuredViews(schema).map((view) => ({
    key: view.key,
    label: view.label,
    kind: viewKind(view, schema),
    ...(view.fieldKey !== undefined ? { fieldKey: view.fieldKey } : {}),
  }));
}

// 有效性同时核对配置项与字段绑定：入口存在，且推导 kind 与当前视图状态一致
export function isViewValid(view, schema) {
  if (!view || !schema) return false;
  return configuredViews(schema).some((item) => viewKind(item, schema) === view.kind
    && (view.kind === 'table' ? item.fieldKey === undefined : item.fieldKey === view.fieldKey));
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
