import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withServer } from './fixture.mjs';
import { defaultSchema } from '../server/schema.mjs';

const json = (method, value) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

async function previewProject(url, dir) {
  const root = path.join(dir, '预览 项目');
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await fetch(url + '/api/register', json('POST', { root }));
  await fetch(url + '/api/projects/confirm', json('POST', { root }));
  await fetch(url + '/api/init', json('POST', { root }));
  await writeFile(path.join(root, 'docs', 'a.md'), '# 标题\n\n正文');
  await writeFile(path.join(root, 'docs', 'b.markdown'), '**Markdown**');
  await writeFile(path.join(root, 'docs', 'note.txt'), '<b>原文</b>');
  await writeFile(path.join(root, 'docs', 'secret.txt'), '不应读取');
  await writeFile(path.join(root, 'docs', 'large.txt'), Buffer.alloc(1024 * 1024 + 1, 97));
  const outside = path.join(dir, 'outside.txt');
  await writeFile(outside, '项目外秘密');
  await symlink(outside, path.join(root, 'docs', 'escape.md'), 'file');

  const schema = defaultSchema();
  schema.fields.push({
    key: 'artifacts', label: '项目文件', type: 'file', description: '文件。',
    default: ['docs/a.md', 'docs/b.markdown', 'docs/note.txt', 'docs/missing.md', 'docs', 'docs/escape.md', 'docs/large.txt'],
  });
  await writeFile(path.join(root, 'kanban', 'thread.schema.json'), JSON.stringify(schema));
  const created = await (await fetch(url + '/api/threads', json('POST', { root, title: '文件预览', slug: 'file-preview' }))).json();
  return { root, id: created.id, file: path.join(root, 'kanban', 'threads', created.id, 'thread.md') };
}

function preview(url, root, id, fieldKey, filePath) {
  const query = new URLSearchParams({ root, id, fieldKey, path: filePath });
  return fetch(`${url}/api/thread/file?${query}`);
}

test('按需预览 Markdown 与其他文本，分类正确且响应 no-store', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const { root, id } = await previewProject(url, dir);
    for (const [filePath, kind, content] of [
      ['docs/a.md', 'markdown', '# 标题\n\n正文'],
      ['docs/b.markdown', 'markdown', '**Markdown**'],
      ['docs/note.txt', 'text', '<b>原文</b>'],
    ]) {
      const response = await preview(url, root, id, 'artifacts', filePath);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { path: filePath, kind, content });
    }
  });
});

test('未注册项目、未登记路径、字段不匹配与实际越界均不返回正文', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const { root, id } = await previewProject(url, dir);
    for (const [targetRoot, fieldKey, filePath, status, code] of [
      [path.join(dir, 'unregistered'), 'artifacts', 'docs/a.md', 403, undefined],
      [root, 'artifacts', 'docs/secret.txt', 403, 'file-not-registered'],
      [root, 'goal', 'docs/a.md', 400, 'bad-request'],
      [root, 'artifacts', '../outside.txt', 400, 'invalid-path'],
      [root, 'artifacts', 'docs/escape.md', 403, 'outside-project'],
    ]) {
      const response = await preview(url, targetRoot, id, fieldKey, filePath);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      if (code) assert.equal(result.code, code);
      assert.equal(result.content, undefined);
      assert.ok(result.error);
    }
  });
});

test('缺失文件与目录返回结构化错误，普通列表和详情不读取超限正文', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const { root, id, file } = await previewProject(url, dir);
    for (const [filePath, status, code] of [['docs/missing.md', 404, 'not-found'], ['docs', 422, 'not-file'], ['docs/large.txt', 422, 'too-large']]) {
      const response = await preview(url, root, id, 'artifacts', filePath);
      assert.equal(response.status, status);
      const result = await response.json();
      assert.equal(result.code, code);
      assert.equal(result.content, undefined);
    }

    const query = new URLSearchParams({ root });
    const list = await fetch(`${url}/api/threads?${query}`);
    assert.equal(list.status, 200);
    const listResult = await list.json();
    assert.ok(listResult.threads[0].fields.artifacts.includes('docs/large.txt'));
    const detail = await fetch(`${url}/api/thread?${query}&id=${id}`);
    assert.equal(detail.status, 200);
    const detailResult = await detail.json();
    assert.ok(detailResult.fields.artifacts.value.includes('docs/large.txt'));
    assert.equal(detailResult.fields.artifacts.content.includes('a'.repeat(1000)), false);

    const before = await readFile(file, 'utf8');
    const update = await fetch(url + '/api/thread/field', json('PUT', { root, id, fieldKey: 'artifacts', value: ['docs/a.md', 'docs/new.txt'], fingerprint: detailResult.fingerprint }));
    assert.equal(update.status, 200);
    assert.notEqual(await readFile(file, 'utf8'), before);
  });
});
