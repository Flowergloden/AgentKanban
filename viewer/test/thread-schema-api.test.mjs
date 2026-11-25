import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withServer } from './fixture.mjs';
import { defaultSchema, schemaFingerprint } from '../server/schema.mjs';

const json = (method, value, headers = {}) => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });

async function registeredProject(url, dir) {
  const root = path.join(dir, 'schema project');
  await mkdir(root, { recursive: true });
  await fetch(url + '/api/register', json('POST', { root }));
  await fetch(url + '/api/projects/confirm', json('POST', { root }));
  return root;
}

test('列表与详情返回 schema 驱动投影并保留兼容字段', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const root = await registeredProject(url, dir);
    const initialized = await (await fetch(url + '/api/init', json('POST', { root }))).json();
    assert.ok(initialized.created.includes('kanban/thread.schema.json'));
    assert.ok(!initialized.created.some((file) => file.includes('template')));
    const schema = defaultSchema();
    schema.fields.push(
      { key: 'priority', label: '优先级', type: 'select', description: '优先级。', options: ['高', '低'], default: '低' },
      { key: 'related', label: '相关线程', type: 'reference', description: '相关线程。' },
    );
    await writeFile(path.join(root, 'kanban', 'thread.schema.json'), JSON.stringify(schema));
    const createdResponse = await fetch(url + '/api/threads', json('POST', { root, title: '接口字段', slug: 'api-fields', goal: '目标内容' }));
    assert.equal(createdResponse.status, 200);
    const { id } = await createdResponse.json();
    const listResponse = await fetch(`${url}/api/threads?root=${encodeURIComponent(root)}`);
    const list = await listResponse.json();
    assert.equal(list.schemaFingerprint.length, 64);
    assert.equal(list.schema.fields.at(-2).key, 'priority');
    const row = list.threads.find((thread) => thread.id === id);
    assert.equal(row.fields.goal, '目标内容');
    assert.equal(row.fields.priority, '低');
    assert.deepEqual(row.fields.related, []);
    assert.equal(row.status, '立项');
    assert.equal(row.goalExcerpt, '目标内容');
    assert.deepEqual(row.deps, []);
    assert.match(row.fingerprint, /^[a-f0-9]{64}$/);

    const file = path.join(root, 'kanban', 'threads', id, 'thread.md');
    await writeFile(file, await readFile(file, 'utf8') + '\n## 未配置\n\n保留内容\n');
    const detail = await (await fetch(`${url}/api/thread?root=${encodeURIComponent(root)}&id=${id}`)).json();
    assert.equal(detail.fields.goal.value, '目标内容');
    assert.match(detail.fields.goal.content, /字段|创建时填写/);
    assert.equal(detail.sections['目标'], detail.fields.goal.content);
    assert.deepEqual(detail.unmappedSections.map((section) => section.name), ['未配置']);
  });
});

test('通用字段接口支持 file 创建、空值投影、保存、非法值与 409', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const root = await registeredProject(url, dir);
    await fetch(url + '/api/init', json('POST', { root }));
    const schema = defaultSchema();
    schema.fields.push({ key: 'artifacts', label: '项目文件', type: 'file', description: '项目内文件，一行一条。', default: ['docs\\默认.md'] });
    await writeFile(path.join(root, 'kanban', 'thread.schema.json'), JSON.stringify(schema));
    const createdResponse = await fetch(url + '/api/threads', json('POST', { root, title: '文件字段', slug: 'file-fields' }));
    assert.equal(createdResponse.status, 200);
    const { id } = await createdResponse.json();
    const file = path.join(root, 'kanban', 'threads', id, 'thread.md');
    const get = () => fetch(`${url}/api/thread?root=${encodeURIComponent(root)}&id=${id}`).then((response) => response.json());
    const put = (value, fingerprint) => fetch(url + '/api/thread/field', json('PUT', { root, id, fieldKey: 'artifacts', value, fingerprint }));

    let detail = await get();
    assert.deepEqual(detail.fields.artifacts.value, ['docs/默认.md']);
    const withoutFile = (await readFile(file, 'utf8')).replace(/\n## 项目文件[\s\S]*$/, '\n');
    await writeFile(file, withoutFile);
    detail = await get();
    assert.deepEqual(detail.fields.artifacts.value, []);
    assert.equal(detail.fields.artifacts.missing, true);
    assert.equal(await readFile(file, 'utf8'), withoutFile);

    let response = await put(['docs\\新 文件.md', 'docs/新 文件.md', 'missing.txt'], detail.fingerprint);
    assert.equal(response.status, 200);
    detail = await get();
    assert.deepEqual(detail.fields.artifacts.value, ['docs/新 文件.md', 'missing.txt']);
    const saved = await readFile(file, 'utf8');
    assert.match(saved, /## 项目文件\n\n<!-- kanban:field=artifacts -->/);

    response = await put(['docs/valid.md', '../outside.txt'], detail.fingerprint);
    assert.equal(response.status, 400);
    assert.equal(await readFile(file, 'utf8'), saved);
    response = await put([], 'stale');
    assert.equal(response.status, 409);
    assert.equal(await readFile(file, 'utf8'), saved);
  });
});

test('通用字段接口支持三类写入、缺字段补建、409 与输入校验', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const root = await registeredProject(url, dir);
    const created = await (await fetch(url + '/api/threads', json('POST', { root, title: '写字段', slug: 'write-fields' }))).json();
    const id = created.id;
    const file = path.join(root, 'kanban', 'threads', id, 'thread.md');
    const get = () => fetch(`${url}/api/thread?root=${encodeURIComponent(root)}&id=${id}`).then((response) => response.json());
    const put = (body, headers) => fetch(url + '/api/thread/field', json('PUT', { root, id, ...body }, headers));

    let detail = await get();
    let response = await put({ fieldKey: 'completed', content: '- 完成接口', fingerprint: detail.fingerprint });
    assert.equal(response.status, 200);
    detail = await get();
    assert.equal(detail.fields.completed.value, '- 完成接口');

    response = await put({ fieldKey: 'status', value: '实现', fingerprint: detail.fingerprint });
    assert.equal(response.status, 200);
    detail = await get();
    assert.equal(detail.status, '实现');
    response = await put({ fieldKey: 'dependencies', value: ['0009', '0002', '0009'], fingerprint: detail.fingerprint });
    assert.equal(response.status, 200);
    detail = await get();
    assert.deepEqual(detail.fields.dependencies.value, ['0009', '0002']);
    assert.deepEqual(detail.sections['依赖'].match(/\d{4}/g), ['0009', '0002']);

    const beforeInvalid = await readFile(file, 'utf8');
    for (const body of [
      { fieldKey: 'unknown', value: 'x', fingerprint: detail.fingerprint },
      { fieldKey: 'status', value: '非法', fingerprint: detail.fingerprint },
      { fieldKey: 'dependencies', value: ['2'], fingerprint: detail.fingerprint },
      { fieldKey: 'completed', value: '错误通道', fingerprint: detail.fingerprint },
    ]) {
      const invalid = await put(body);
      assert.equal(invalid.status, 400);
      assert.equal(await readFile(file, 'utf8'), beforeInvalid);
    }
    const conflict = await put({ fieldKey: 'completed', content: '冲突', fingerprint: 'stale' });
    assert.equal(conflict.status, 409);
    assert.equal(await readFile(file, 'utf8'), beforeInvalid);

    const schema = defaultSchema();
    schema.fields.push({ key: 'owner', label: '负责人', type: 'select', description: '负责人。', options: ['甲', '乙'], default: '甲' });
    await writeFile(path.join(root, 'kanban', 'thread.schema.json'), JSON.stringify(schema));
    detail = await get();
    assert.equal(detail.fields.owner.missing, true);
    response = await put({ fieldKey: 'owner', value: '乙', fingerprint: detail.fingerprint });
    assert.equal(response.status, 200);
    assert.match(await readFile(file, 'utf8'), /## 负责人\n\n<!-- kanban:field=owner -->[\s\S]*\n乙\n$/);

    assert.equal((await fetch(url + '/api/thread/field', { method: 'PUT', body: '{}' })).status, 415);
    assert.equal((await put({ fieldKey: 'status', value: '完成', fingerprint: detail.fingerprint }, { origin: 'https://evil.example' })).status, 403);
  });
});

test('非法 schema 明确失败且服务协议保持 1', async (t) => {
  await withServer(t, async ({ url, dir, healthy }) => {
    assert.equal(healthy.protocolVersion, 1);
    const root = await registeredProject(url, dir);
    await fetch(url + '/api/init', json('POST', { root }));
    await writeFile(path.join(root, 'kanban', 'thread.schema.json'), '{');
    const response = await fetch(`${url}/api/threads?root=${encodeURIComponent(root)}`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /thread\.schema\.json.*JSON 解析失败/);
    assert.equal((await fetch(url + '/api/health')).status, 200);
  });
});

test('列表与详情返回有效 views；非法视图配置明确定位报错并拒绝写操作', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const root = await registeredProject(url, dir);
    await fetch(url + '/api/init', json('POST', { root }));
    const list = await (await fetch(`${url}/api/threads?root=${encodeURIComponent(root)}`)).json();
    assert.deepEqual(list.schema.views.map((view) => view.key), ['all', 'status-board', 'dependency-graph']);
    assert.equal(list.schemaFingerprint, schemaFingerprint(list.schema));

    const schema = defaultSchema();
    schema.views = [{ key: 'only-board', label: '只看板', fieldKey: 'status' }];
    await writeFile(path.join(root, 'kanban', 'thread.schema.json'), JSON.stringify(schema));
    const response = await fetch(`${url}/api/threads?root=${encodeURIComponent(root)}`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /\$\.views.*table/);
    const put = await fetch(url + '/api/thread/field', json('PUT', { root, id: '0001-x', fieldKey: 'goal', content: 'x', fingerprint: 'x' }));
    assert.equal(put.status, 400);
    assert.equal((await fetch(url + '/api/health')).status, 200);
  });
});
