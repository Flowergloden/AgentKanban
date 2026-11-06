import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withServer } from './fixture.mjs';

const json = (value) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
const canon = (root) => root.replace(/\\/g, '/').toLowerCase();

async function diskProjects(dir) {
  return JSON.parse(await readFile(path.join(dir, 'data', 'registry.json'), 'utf8')).projects;
}

test('confirm, manual add, ignore and delete cover all state transitions with atomic persistence', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const post = (p, body) => fetch(url + p, json(body));
    const del = (body) => fetch(url + '/api/projects', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const projects = async () => await (await fetch(url + '/api/projects')).json();
    const byRoot = (list, root) => list.find((p) => p.root === canon(root));

    // 待确认 -> 已注册（新路径确认同样成立）
    const rootA = path.join(dir, 'project A');
    await post('/api/register', { root: rootA });
    assert.equal(byRoot(await projects(), rootA).state, 'pending');
    assert.equal((await post('/api/projects/confirm', { root: rootA })).status, 200);
    assert.equal(byRoot(await projects(), rootA).state, 'registered');
    assert.equal((await diskProjects(dir))[canon(rootA)].state, 'registered');
    // 确认幂等
    assert.equal((await post('/api/projects/confirm', { root: rootA })).status, 200);
    assert.equal((await projects()).length, 1);

    // 已注册 -> 已忽略 -> 取消忽略恢复已注册；忽略保留 lastSeen 与项目文件
    const seen = byRoot(await projects(), rootA).lastSeen;
    assert.equal((await post('/api/projects/ignore', { root: rootA })).status, 200);
    assert.equal(byRoot(await projects(), rootA).state, 'ignored');
    assert.equal((await diskProjects(dir))[canon(rootA)].state, 'ignored');
    assert.equal((await post('/api/projects/confirm', { root: rootA })).status, 200);
    assert.equal(byRoot(await projects(), rootA).state, 'registered');
    assert.equal(byRoot(await projects(), rootA).lastSeen >= seen, true);

    // 手动新增：现存目录直接 registered，且不创建 kanban/、不自动切换
    const rootB = path.join(dir, 'existing B');
    await mkdir(rootB, { recursive: true });
    assert.equal((await post('/api/projects', { root: rootB })).status, 200);
    assert.equal(byRoot(await projects(), rootB).state, 'registered');
    assert.equal((await diskProjects(dir))[canon(rootB)].state, 'registered');
    await assert.rejects(readFile(path.join(rootB, 'kanban', 'current')), /ENOENT/);

    // 重复手动新增（与 pending 等价路径）：不产生重复记录并确认到 registered
    const rootC = path.join(dir, 'pending C');
    await mkdir(rootC, { recursive: true });
    await post('/api/register', { root: rootC });
    assert.equal((await post('/api/projects', { root: rootC })).status, 200);
    assert.equal((await projects()).filter((p) => p.root === canon(rootC)).length, 1);
    assert.equal(byRoot(await projects(), rootC).state, 'registered');

    // 无效手动新增：相对路径、文件路径、不存在目录均 400 且注册表不变
    const before = await projects();
    assert.equal((await post('/api/projects', { root: 'rel\\path' })).status, 400);
    const fileTarget = path.join(dir, 'a file.txt');
    await writeFile(fileTarget, 'x');
    assert.equal((await post('/api/projects', { root: fileTarget })).status, 400);
    assert.equal((await post('/api/projects', { root: path.join(dir, 'absent') })).status, 400);
    assert.equal((await post('/api/projects', { root: '' })).status, 400);
    assert.deepEqual(await projects(), before);

    // 删除 registered：项目目录保持原样，注册记录消失；再次自动发现只回到 pending
    assert.equal((await del({ root: rootB })).status, 200);
    assert.equal(byRoot(await projects(), rootB), undefined);
    assert.equal((await diskProjects(dir))[canon(rootB)], undefined);
    assert.equal((await readFile(fileTarget, 'utf8')), 'x');
    await post('/api/register', { root: rootB });
    assert.equal(byRoot(await projects(), rootB).state, 'pending');
    // 删除 pending
    assert.equal((await del({ root: rootB })).status, 200);
    // 删除 ignored 与未登记
    await post('/api/projects/ignore', { root: rootA });
    assert.equal((await del({ root: rootA })).status, 200);
    assert.equal((await del({ root: rootA })).status, 404);
    assert.equal((await post('/api/projects/ignore', { root: path.join(dir, 'never seen') })).status, 404);
  });
});

test('project write endpoints enforce same-origin and JSON content type', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const root = path.join(dir, 'guarded');
    const post = (p, body, extra = {}) => fetch(url + p, { ...json(body), ...extra });
    assert.equal((await post('/api/projects/confirm', { root }, { headers: { origin: 'http://evil.test', 'content-type': 'application/json' } })).status, 403);
    assert.equal((await post('/api/projects/confirm', { root }, { headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await fetch(url + '/api/projects', { method: 'DELETE', ...json({ root }), headers: { origin: 'http://evil.test', 'content-type': 'application/json' } })).status, 403);
    assert.equal((await fetch(url + '/api/projects', { method: 'DELETE', ...json({ root }), headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await post('/api/projects/ignore', { root }, { headers: { origin: 'http://evil.test', 'content-type': 'application/json' } })).status, 403);
    // 被拒绝的请求不改变注册表
    assert.deepEqual(await (await fetch(url + '/api/projects')).json(), []);
    assert.equal((await diskProjects(dir).then(() => true, () => false)), false);
  });
});

test('GET /api/projects carries state for all three states and keeps lastSeen ordering data', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const post = (p, body) => fetch(url + p, json(body));
    const rootP = path.join(dir, 'pending p');
    const rootR = path.join(dir, 'registered r');
    const rootI = path.join(dir, 'ignored i');
    await post('/api/register', { root: rootP });
    await post('/api/register', { root: rootR });
    await post('/api/projects/confirm', { root: rootR });
    await post('/api/register', { root: rootI });
    await post('/api/projects/ignore', { root: rootI });
    const projects = await (await fetch(url + '/api/projects')).json();
    assert.equal(projects.length, 3);
    const states = Object.fromEntries(projects.map((p) => [p.root, p.state]));
    assert.equal(states[canon(rootP)], 'pending');
    assert.equal(states[canon(rootR)], 'registered');
    assert.equal(states[canon(rootI)], 'ignored');
    for (const p of projects) assert.equal(Number.isFinite(p.lastSeen), true);
    // lastSeen 降序完整（主选择器排序数据）
    const seen = projects.map((p) => p.lastSeen);
    assert.deepEqual([...seen].sort((a, b) => b - a), seen);
    // 注册表重启后三态完整保留
    const disk = await diskProjects(dir);
    assert.equal(disk[canon(rootP)].state, 'pending');
    assert.equal(disk[canon(rootR)].state, 'registered');
    assert.equal(disk[canon(rootI)].state, 'ignored');
  });
});
