import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withServer } from './fixture.mjs';
import { defaultSchema } from '../server/schema.mjs';

const json = (method, value, headers = {}) => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });

async function withPicker(t, body) {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'kanban-picker-fixture-'));
  const fixtureFile = path.join(fixtureDir, 'selection.json');
  await writeFile(fixtureFile, '{ "paths": [] }');
  t.after(() => rm(fixtureDir, { recursive: true, force: true }));
  await withServer(t, async (context) => body({
    ...context,
    select: (value) => writeFile(fixtureFile, JSON.stringify(value)),
  }), { env: { AGENT_KANBAN_FILE_PICKER_FIXTURE: fixtureFile } });
}

async function fileProject(url, dir) {
  const root = path.join(dir, '文件 项目');
  await mkdir(root, { recursive: true });
  await fetch(url + '/api/register', json('POST', { root }));
  await fetch(url + '/api/projects/confirm', json('POST', { root }));
  await fetch(url + '/api/init', json('POST', { root }));
  const schema = defaultSchema();
  schema.fields.push({ key: 'artifacts', label: '项目文件', type: 'file', description: '文件。' });
  await writeFile(path.join(root, 'kanban', 'thread.schema.json'), JSON.stringify(schema));
  const created = await (await fetch(url + '/api/threads', json('POST', { root, title: '文件选择', slug: 'file-selection' }))).json();
  const file = path.join(root, 'kanban', 'threads', created.id, 'thread.md');
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'a.md'), '# A');
  await writeFile(path.join(root, 'docs', '中文 空格.txt'), '文本');
  return { root, id: created.id, file };
}

const select = (url, root, id, fieldKey = 'artifacts', headers) => fetch(url + '/api/thread/file-selection', json('POST', { root, id, fieldKey }, headers));

test('合法多选与取消返回路径且不写卷宗', async (t) => {
  await withPicker(t, async ({ url, dir, select: setSelection }) => {
    const { root, id, file } = await fileProject(url, dir);
    const before = await readFile(file, 'utf8');
    await setSelection({ paths: [path.join(root, 'docs', 'a.md'), path.join(root, 'docs', '中文 空格.txt')] });
    let response = await select(url, root, id);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { paths: ['docs/a.md', 'docs/中文 空格.txt'] });
    assert.equal(await readFile(file, 'utf8'), before);

    await setSelection({ paths: [] });
    response = await select(url, root, id);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { paths: [] });
    assert.equal(await readFile(file, 'utf8'), before);
  });
});

test('混合选择、目录、缺失与越界链接整批 422 并聚合错误', async (t) => {
  await withPicker(t, async ({ url, dir, select: setSelection }) => {
    const { root, id, file } = await fileProject(url, dir);
    const outside = path.join(dir, 'outside.txt');
    const missing = path.join(root, 'docs', 'missing.txt');
    const directory = path.join(root, 'docs');
    const link = path.join(root, 'docs', 'escape.txt');
    await writeFile(outside, 'outside');
    await symlink(outside, link, 'file');
    const before = await readFile(file, 'utf8');
    await setSelection({ paths: [path.join(root, 'docs', 'a.md'), outside, missing, directory, link] });

    const response = await select(url, root, id);
    assert.equal(response.status, 422);
    const result = await response.json();
    assert.equal(result.code, 'selection-rejected');
    assert.equal(result.paths, undefined);
    assert.deepEqual(result.rejected.map((item) => item.path), [outside, missing, directory, link]);
    assert.match(result.rejected[0].reason, /项目内/);
    assert.match(result.rejected[1].reason, /不存在/);
    assert.match(result.rejected[2].reason, /普通文件/);
    assert.match(result.rejected[3].reason, /项目内/);
    assert.equal(await readFile(file, 'utf8'), before);
  });
});

test('未注册、跨源、未知线程与非 file 字段均不启动选择器', async (t) => {
  await withPicker(t, async ({ url, dir, select: setSelection }) => {
    const { root, id } = await fileProject(url, dir);
    await setSelection({ error: { code: 'picker-process', message: '不应启动选择器' } });
    const unregistered = path.join(dir, 'unregistered');
    assert.equal((await select(url, unregistered, id)).status, 403);
    assert.equal((await select(url, root, id, 'artifacts', { origin: 'https://evil.example' })).status, 403);
    assert.equal((await select(url, root, '9999-missing')).status, 404);
    assert.equal((await select(url, root, id, 'goal')).status, 400);
    assert.equal((await fetch(url + '/api/thread/file-selection', { method: 'POST', body: '{}' })).status, 415);
  });
});

test('延迟选择期间服务保持响应，完成后正常返回并释放操作', async (t) => {
  await withPicker(t, async ({ url, dir, select: setSelection }) => {
    const { root, id } = await fileProject(url, dir);
    await setSelection({ paths: [path.join(root, 'docs', 'a.md')], delayMs: 300 });
    const pending = select(url, root, id);
    await delay(100);
    assert.equal((await fetch(url + '/api/health')).status, 200);
    const response = await pending;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { paths: ['docs/a.md'] });
    assert.equal((await fetch(url + '/api/health')).status, 200);
  });
});

test('选择器进程失败返回错误且不写卷宗', async (t) => {
  await withPicker(t, async ({ url, dir, select: setSelection }) => {
    const { root, id, file } = await fileProject(url, dir);
    const before = await readFile(file, 'utf8');
    await setSelection({ error: { code: 'picker-exit', message: 'PowerShell 异常退出' } });
    const response = await select(url, root, id);
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /PowerShell 异常退出/);
    assert.equal(await readFile(file, 'utf8'), before);
  });
});
