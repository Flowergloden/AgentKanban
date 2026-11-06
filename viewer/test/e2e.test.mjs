import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalRoot } from '../server/registry.mjs';
import { withServer } from './fixture.mjs';
import { useShim, shimLog } from './shim.mjs';
import { pickRecentRegistered, nextRootAfterRemoval, findProject } from '../web/project-state.js';

const exec = promisify(execFile);
const viewer = fileURLToPath(new URL('..', import.meta.url));
const json = (value) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
const postJson = (method, value) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

async function hasKanban(root) {
  try {
    return (await readdir(root)).includes('kanban');
  } catch {
    return false;
  }
}

// 端到端：隔离端口 + 临时 AGENT_KANBAN_HOME 下走完整闭环，
// 核对 API、页面渲染所需投影（状态/layout）、注册表落盘与项目文件，不触碰真实注册表。
test('end-to-end: discover -> confirm/ignore -> explicit OpenKanban -> init -> delete/re-discover', async (t) => {
  const shimDir = await mkdtemp(path.join(os.tmpdir(), 'kanban-e2e-shim-'));
  t.after(() => rm(shimDir, { recursive: true, force: true }));
  useShim(t, { mapped: false }, path.join(shimDir, 'log')); // 无 p4：检测按非 P4 缓存

  await withServer(t, async ({ url, dir, childEnv }) => {
    const post = (p, body) => fetch(url + p, postJson('POST', body));
    const del = (body) => fetch(url + '/api/projects', { method: 'DELETE', ...json(body) });
    const list = async () => await (await fetch(url + '/api/projects')).json();
    const disk = async () => JSON.parse(await readFile(path.join(dir, 'data', 'registry.json'), 'utf8')).projects;
    const canon = (r) => canonicalRoot(r);

    // 1) 自动发现：会话活动只建立待确认记录，零 p4 调用
    const rootA = path.join(dir, 'proj A');
    const rootB = path.join(dir, 'proj B');
    await mkdir(rootA, { recursive: true });
    await mkdir(rootB, { recursive: true });
    await post('/api/register', { root: rootA });
    await post('/api/activity', { root: rootA });
    assert.equal(findProject(await list(), rootA).state, 'pending');
    assert.equal((await disk())[canon(rootA)].state, 'pending');
    assert.deepEqual(await shimLog(path.join(shimDir, 'log')), []);

    // 2) Web 确认/忽略：rootA 确认；rootB 忽略后活动不改其记录但仍续期服务
    await post('/api/projects/confirm', { root: rootA });
    assert.equal(findProject(await list(), rootA).state, 'registered');
    await post('/api/register', { root: rootB });
    const seenBeforeIgnore = findProject(await list(), rootB).lastSeen;
    await post('/api/projects/ignore', { root: rootB });
    const ignored = await post('/api/activity', { root: rootB });
    assert.equal(ignored.status, 200);
    const rootBAfter = findProject(await list(), rootB);
    assert.equal(rootBAfter.state, 'ignored');
    assert.equal(rootBAfter.lastSeen, seenBeforeIgnore);
    // 页面加载投影：已注册但无 kanban/ 时 layout=false（页面显示「初始化/忽略」视图），且不自动创建结构
    const beforeInit = await (await fetch(`${url}/api/threads?root=${encodeURIComponent(canon(rootA))}`)).json();
    assert.equal(beforeInit.layout, false);
    assert.deepEqual(beforeInit.threads, []);
    assert.equal(await hasKanban(rootA), false);

    // 3) 显式 OpenKanban：open.mjs 将未登记路径确认为已注册后才给出 URL；确认本身不初始化
    const rootC = path.join(dir, 'proj C');
    const opened = await exec(process.execPath, [path.join(viewer, 'server', 'open.mjs'), rootC], {
      env: { ...childEnv, AGENT_KANBAN_OPEN_DRY_RUN: '1' },
    });
    assert.equal(new URL(opened.stdout.trim()).searchParams.get('root'), rootC);
    assert.equal(findProject(await list(), rootC).state, 'registered');
    assert.equal(await hasKanban(rootC), false);

    // 4) 初始化：创建最小结构后页面进入线程视图；检测缓存写入注册表
    const init = await (await post('/api/init', { root: rootA })).json();
    assert.ok(init.created.includes('kanban/current'));
    assert.ok(init.created.includes('kanban/note.md'));
    const afterInit = await (await fetch(`${url}/api/threads?root=${encodeURIComponent(canon(rootA))}`)).json();
    assert.equal(afterInit.layout, true);
    assert.equal(findProject(await list(), rootA).vcs.type, null);

    // 5) 删除与再发现：注册记录消失、再次活动只回到待确认
    assert.equal((await del({ root: rootA })).status, 200);
    assert.equal(findProject(await list(), rootA), null);
    assert.equal((await disk())[canon(rootA)], undefined);
    assert.equal(await hasKanban(rootA), true); // 已初始化的项目文件不受删除影响
    await post('/api/register', { root: rootA });
    assert.equal(findProject(await list(), rootA).state, 'pending');

    // 6) 页面选择逻辑核对：最近已注册项目与移除当前后的下一落点
    const projects = await list();
    assert.equal(pickRecentRegistered(projects), canon(rootC)); // rootA 回到 pending、rootB 已忽略
    assert.equal(nextRootAfterRemoval(projects, canon(rootC)), ''); // 无其他已注册项目 → 空状态
    assert.equal(nextRootAfterRemoval(projects, canon(rootB)), canon(rootC)); // 移除非当前项目不影响当前选择

    // 隔离核对：注册表落在临时 AGENT_KANBAN_HOME 内（tmpdir），真实注册表未被触碰
    assert.equal(path.parse(dir).root.toLowerCase(), path.parse(os.tmpdir()).root.toLowerCase());
    assert.ok(dir.startsWith(os.tmpdir()));
  });
});
