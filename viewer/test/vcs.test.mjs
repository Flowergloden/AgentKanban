import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm, access } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as vcs from '../server/vcs.mjs';
import * as threads from '../server/threads.mjs';
import { withServer } from './fixture.mjs';

const shim = fileURLToPath(new URL('./p4-shim.mjs', import.meta.url));

// 在当前进程启用假 p4（AGENT_KANBAN_P4_SHIM 由 vcs.mjs 惰性读取）。
// 规格写入临时文件并经 P4SHIM_SPEC_FILE 传递：shim 每次调用重新读文件，
// 因此服务子进程启动后测试仍可改行为；返回 setSpec 用于中途改规格。
function useShim(t, spec = {}, logFile = null) {
  const prev = {
    AGENT_KANBAN_P4_SHIM: process.env.AGENT_KANBAN_P4_SHIM,
    P4SHIM_SPEC_FILE: process.env.P4SHIM_SPEC_FILE,
    P4SHIM_LOG: process.env.P4SHIM_LOG,
  };
  const specFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'kanban-p4spec-')), 'spec.json');
  writeFileSync(specFile, JSON.stringify(spec));
  process.env.AGENT_KANBAN_P4_SHIM = shim;
  process.env.P4SHIM_SPEC_FILE = specFile;
  if (logFile) process.env.P4SHIM_LOG = logFile;
  else delete process.env.P4SHIM_LOG;
  t.after(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return (next) => writeFileSync(specFile, JSON.stringify(next));
}

async function shimLog(logFile) {
  try {
    const raw = await readFile(logFile, 'utf8');
    return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function tempRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kanban-vcs-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const relThread = (id) => `kanban/threads/${id}/thread.md`;

// ---- 2.1 spawn 基础层与三态分类 ----

test('classifyP4Output 三态分类', () => {
  assert.deepEqual(vcs.classifyP4Output(0, '//depot/... //client/... C:/x'), { state: 'ok' });
  assert.deepEqual(vcs.classifyP4Output(0, 'kanban/x.txt - file(s) not on client.'), { state: 'unmanaged' });
  assert.deepEqual(vcs.classifyP4Output(0, 'kanban/x.txt - no such file(s).'), { state: 'unmanaged' });
  assert.deepEqual(vcs.classifyP4Output(1, "Perforce client error:\n\tPartner exited unexpectedly."), {
    state: 'hard-fail',
    reason: 'Perforce client error:；Partner exited unexpectedly.',
  });
});

test('parseFstat 三态解析', () => {
  const depot = vcs.parseFstat('... depotFile //d/k\n... clientFile C:\\x\n... headRev 1\n... haveRev 1\n');
  assert.deepEqual(depot, { file: 'depot', open: null });
  const opened = vcs.parseFstat('... depotFile //d/k\n... action edit\n... headRev 1\n');
  assert.deepEqual(opened, { file: 'depot', open: 'edit' });
  const add = vcs.parseFstat('... depotFile //d/k\n... action add\n... workRev 1\n');
  assert.deepEqual(add, { file: 'add', open: 'add' });
  assert.deepEqual(vcs.parseFstat('kanban/x.txt - no such file(s).'), { file: 'unmanaged', open: null });
});

test('PATH 无 p4 时 detect 判不可用（非 P4）且不报错', async (t) => {
  const root = await tempRoot(t);
  const emptyBin = await mkdtemp(path.join(os.tmpdir(), 'kanban-empty-bin-'));
  t.after(() => rm(emptyBin, { recursive: true, force: true }));
  const savedPath = process.env.PATH;
  process.env.PATH = emptyBin;
  t.after(() => { process.env.PATH = savedPath; });
  delete process.env.AGENT_KANBAN_P4_SHIM;
  assert.equal(await vcs.detect(root), null);
  // 动词包装同样落回 unmanaged（调用方按普通文件处理）
  assert.deepEqual(await vcs.edit(root, path.join(root, 'kanban', 'x.txt')), { state: 'unmanaged' });
});

// ---- 2.2 detect 三分支 ----

test('detect：映射 / 未映射 / 服务器不可达 unknown 三分支', async (t) => {
  const root = await tempRoot(t);
  const logFile = path.join(root, 'shim.log');
  const setSpec = useShim(t, { mapped: true }, logFile);
  assert.equal(await vcs.detect(root), 'p4');
  assert.deepEqual((await shimLog(logFile)).map((c) => c[0]), ['-V', 'where']);

  setSpec({ mapped: false });
  assert.equal(await vcs.detect(root), null);

  setSpec({ offline: true });
  assert.equal(await vcs.detect(root), 'unknown');
});

// ---- 2.3 动词包装 ----

test('动词包装：edit/add/del/move/revert/fstat 的成功、unmanaged 与 hard-fail 路径', async (t) => {
  const root = await tempRoot(t);
  const file = path.join(root, 'kanban', 'x.txt');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'x');
  const setSpec = useShim(t, { files: { 'kanban/x.txt': 'depot' } });

  assert.equal((await vcs.edit(root, file)).state, 'ok');
  assert.equal((await vcs.add(root, [file])).state, 'ok');
  assert.equal((await vcs.del(root, file)).state, 'ok');
  assert.equal((await vcs.revert(root, file)).state, 'ok');
  assert.deepEqual(await vcs.fstat(root, file), { state: 'ok', file: 'depot', open: null });

  setSpec({ files: { 'kanban/x.txt': 'unmanaged' } });
  assert.equal((await vcs.edit(root, file)).state, 'unmanaged');

  setSpec({ files: { 'kanban/x.txt': 'depot' }, editFail: 'Perforce client error:\n\tfile(s) locked by user@client' });
  const failed = await vcs.edit(root, file);
  assert.equal(failed.state, 'hard-fail');
  assert.match(failed.reason, /locked/);
});

// ---- 4.1 写盘前 checkout ----

test('P4 项目写盘前 checkout：ok / unmanaged 落回 / hard-fail 不写盘', async (t) => {
  const root = await tempRoot(t);
  await threads.ensureLayout(root);
  const { id } = await threads.create(root, 'VCS thread', 'vcs-thread');
  const file = path.join(root, relThread(id));
  const rel = relThread(id);
  const logFile = path.join(root, 'shim.log');
  const setSpec = useShim(t, { files: { [rel]: 'depot' } }, logFile);
  vcs.setCached(root, 'p4');

  const detail = await threads.getThread(root, id);
  await threads.updateSection(root, id, '已完成的工作', '进展 A', detail.fingerprint);
  let calls = await shimLog(logFile);
  assert.deepEqual(calls.map((c) => c[0]), ['edit']);
  assert.match(await readFile(file, 'utf8'), /进展 A/);

  // unmanaged：p4 edit 报告未纳入管理，按普通文件写盘成功
  setSpec({ files: { [rel]: 'unmanaged' } });
  const detail2 = await threads.getThread(root, id);
  await threads.updateSection(root, id, '已完成的工作', '进展 B', detail2.fingerprint);
  assert.match(await readFile(file, 'utf8'), /进展 B/);

  // hard-fail：不写盘，返回携带原因的明确错误
  setSpec({ files: { [rel]: 'depot' }, editFail: 'Perforce client error：文件被锁定' });
  const detail3 = await threads.getThread(root, id);
  await assert.rejects(
    threads.updateSection(root, id, '已完成的工作', '进展 C', detail3.fingerprint),
    (err) => err.code === 'vcs-error' && /P4 checkout 失败/.test(err.message) && /锁定/.test(err.message),
  );
  assert.match(await readFile(file, 'utf8'), /进展 B/);
});

// ---- 4.2 EPERM 兜底阶梯 ----

test('EPERM 兜底：缓存非 P4 + 只读文件 → 重检翻转 P4 → checkout 后重试成功', async (t) => {
  const root = await tempRoot(t);
  await threads.ensureLayout(root);
  const { id } = await threads.create(root, 'Ladder thread', 'ladder-thread');
  const file = path.join(root, relThread(id));
  const rel = relThread(id);
  const logFile = path.join(root, 'shim.log');
  // 缓存非 P4（无 setCached）；shim 检测为受管，edit 会真正把文件改为可写
  useShim(t, { mapped: true, chmodWritable: true, files: { [rel]: 'depot' } }, logFile);

  await chmod(file, 0o444);
  const detail = await threads.getThread(root, id);
  await threads.updateSection(root, id, '已完成的工作', '兜底成功', detail.fingerprint);
  assert.match(await readFile(file, 'utf8'), /兜底成功/);
  assert.equal(vcs.getCached(root), 'p4');
  const calls = (await shimLog(logFile)).map((c) => c[0]);
  assert.deepEqual(calls, ['-V', 'where', 'edit']); // 重检（-V+where）+ checkout 一次
  await chmod(file, 0o666);
});

test('EPERM 兜底：重检仍非 P4 则返回明确错误；非 P4 正常写盘零 p4 调用', async (t) => {
  const root = await tempRoot(t);
  await threads.ensureLayout(root);
  const { id } = await threads.create(root, 'Plain thread', 'plain-thread');
  const file = path.join(root, relThread(id));
  const logFile = path.join(root, 'shim.log');
  const setSpec = useShim(t, { mapped: false }, logFile);

  await chmod(file, 0o444);
  const detail = await threads.getThread(root, id);
  await assert.rejects(
    threads.updateSection(root, id, '已完成的工作', 'x', detail.fingerprint),
    (err) => err.code === 'write-failed' && /只读/.test(err.message),
  );
  const redetectCalls = (await shimLog(logFile)).map((c) => c[0]);
  assert.deepEqual(redetectCalls, ['-V', 'where']); // 仅重检一次，无任何动词调用
  await chmod(file, 0o666);

  // 非 P4 项目正常写路径零 p4 调用
  const detail2 = await threads.getThread(root, id);
  await threads.updateSection(root, id, '已完成的工作', '正常写入', detail2.fingerprint);
  assert.match(await readFile(file, 'utf8'), /正常写入/);
  assert.equal((await shimLog(logFile)).length, redetectCalls.length); // 写路径不产生新调用
});

// ---- 4.3 created 列表 ----

test('create 返回 created 列表（含 ensureLayout 与卷宗，排除临时文件）', async (t) => {
  const root = await tempRoot(t);
  const { id, created } = await threads.create(root, 'Created thread', 'created-thread');
  assert.equal(id, '0001-created-thread');
  assert.ok(created.includes('kanban/current'));
  assert.ok(created.includes('kanban/note.md'));
  assert.ok(created.includes('kanban/templates/thread.md'));
  assert.ok(created.includes(relThread(id)));
  assert.ok(created.every((f) => !f.endsWith('.tmp')));
});

// ---- 4.4 remove 三态门控 ----

test('remove 三态门控：depot / open-for-edit / open-for-add / unmanaged', async (t) => {
  const root = await tempRoot(t);
  await threads.ensureLayout(root);
  const logFile = path.join(root, 'shim.log');
  const setSpec = useShim(t, {}, logFile);

  // depot：p4 delete
  const a = await threads.create(root, 'A', 'thread-a');
  setSpec({ files: { [relThread(a.id)]: 'depot' } });
  vcs.setCached(root, 'p4');
  await threads.remove(root, a.id);
  assert.deepEqual((await shimLog(logFile)).map((c) => c[0]), ['fstat', 'delete']);
  await assert.rejects(access(path.join(root, 'kanban', 'threads', a.id)), /ENOENT/);

  // open-for-edit：先 revert 再 delete（实测 p4 delete 对 open-for-edit 静默 no-op）
  const b = await threads.create(root, 'B', 'thread-b');
  setSpec({ files: { [relThread(b.id)]: { open: 'edit' } } });
  await threads.remove(root, b.id);
  assert.deepEqual((await shimLog(logFile)).map((c) => c[0]), ['fstat', 'delete', 'fstat', 'revert', 'delete']);
  await assert.rejects(access(path.join(root, 'kanban', 'threads', b.id)), /ENOENT/);

  // open-for-add：revert 记录 + 普通删除
  const c = await threads.create(root, 'C', 'thread-c');
  const beforeC = (await shimLog(logFile)).length;
  setSpec({ files: { [relThread(c.id)]: 'add' } });
  await threads.remove(root, c.id);
  const calls = await shimLog(logFile);
  assert.deepEqual(calls.slice(beforeC).map((x) => x[0]), ['fstat', 'revert']);
  await assert.rejects(access(path.join(root, 'kanban', 'threads', c.id)), /ENOENT/);

  // unmanaged：纯文件删除，零动词调用
  const d = await threads.create(root, 'D', 'thread-d');
  const before = calls.length;
  setSpec({ files: { [relThread(d.id)]: 'unmanaged' } });
  await threads.remove(root, d.id);
  const after = await shimLog(logFile);
  assert.equal(after.length, before + 1); // 仅 fstat
  assert.equal(after[after.length - 1][0], 'fstat');
  await assert.rejects(access(path.join(root, 'kanban', 'threads', d.id)), /ENOENT/);
});

// ---- 4.5 rename 三态门控 ----

test('rename 三态门控：depot p4 move / open-for-add FS+revert+add / unmanaged 纯 FS', async (t) => {
  const root = await tempRoot(t);
  await threads.ensureLayout(root);
  const logFile = path.join(root, 'shim.log');
  const setSpec = useShim(t, {}, logFile);

  // depot：p4 move，盘上完成改名
  const a = await threads.create(root, 'A', 'thread-a');
  setSpec({ files: { [relThread(a.id)]: 'depot' } });
  vcs.setCached(root, 'p4');
  const ra = await threads.rename(root, a.id, 'renamed-a');
  assert.equal(ra.id, '0001-renamed-a');
  assert.deepEqual((await shimLog(logFile)).map((c) => c[0]), ['fstat', 'move']);
  await access(path.join(root, relThread(ra.id)));
  await assert.rejects(access(path.join(root, relThread(a.id))), /ENOENT/);

  // open-for-edit 的 depot 文件：p4 move 直接成立（实测 1.3a）
  const b = await threads.create(root, 'B', 'thread-b');
  setSpec({ files: { [relThread(b.id)]: { open: 'edit' } } });
  const rb = await threads.rename(root, b.id, 'renamed-b');
  assert.equal(rb.id, '0002-renamed-b');
  assert.deepEqual((await shimLog(logFile)).map((c) => c[0]), ['fstat', 'move', 'fstat', 'move']);
  await access(path.join(root, relThread(rb.id)));

  // open-for-add：FS 改名 + revert 旧路径 + add 新路径
  const c = await threads.create(root, 'C', 'thread-c');
  setSpec({ files: { [relThread(c.id)]: 'add' } });
  const rc = await threads.rename(root, c.id, 'renamed-c');
  assert.equal(rc.id, '0003-renamed-c');
  const calls = await shimLog(logFile);
  assert.deepEqual(calls.slice(4).map((x) => x[0]), ['fstat', 'revert', 'add']);
  assert.equal(calls[5][1], relThread(c.id)); // revert 的是旧路径
  assert.equal(calls[6][1], relThread(rc.id)); // add 的是新路径
  await access(path.join(root, relThread(rc.id)));

  // unmanaged：纯 FS 改名
  const d = await threads.create(root, 'D', 'thread-d');
  const before = calls.length;
  setSpec({ files: { [relThread(d.id)]: 'unmanaged' } });
  const rd = await threads.rename(root, d.id, 'renamed-d');
  assert.equal(rd.id, '0004-renamed-d');
  const after = await shimLog(logFile);
  assert.equal(after.length, before + 1);
  assert.equal(after[after.length - 1][0], 'fstat');
  await access(path.join(root, relThread(rd.id)));
});

test('活跃线程重命名时 kanban/current 同步写走 checkout 包装', async (t) => {
  const root = await tempRoot(t);
  await threads.ensureLayout(root);
  const { id } = await threads.create(root, 'Active', 'active-thread');
  await threads.setActive(root, id);
  const logFile = path.join(root, 'shim.log');
  useShim(t, {
    files: {
      [relThread(id)]: 'depot',
      'kanban/current': 'depot',
    },
  }, logFile);
  vcs.setCached(root, 'p4');

  const renamed = await threads.rename(root, id, 'active-renamed');
  assert.equal(renamed.id, '0001-active-renamed');
  const calls = await shimLog(logFile);
  assert.deepEqual(calls.map((c) => c[0]), ['fstat', 'move', 'edit']);
  assert.equal(calls[2][1], 'kanban/current');
  assert.equal((await readFile(path.join(root, 'kanban', 'current'), 'utf8')).trim(), renamed.id);
});

// ---- 3.2 / 5.1 / 5.2 服务端接线 ----

test('注册与 init 执行检测并刷新注册表缓存；/api/projects 携带 vcs；/api/vcs/add 越界拒绝', async (t) => {
  const root = await tempRoot(t);
  const normRoot = root.replace(/\\/g, '/'); // 注册表与接口均返回归一化 root
  const logFile = path.join(root, 'server-shim.log');
  const setSpec = useShim(t, { mapped: true }, logFile);

  await withServer(t, async ({ url, dir }) => {
    const post = (p, body) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    // 注册即检测（shim 受管）并写入注册表
    let res = await post('/api/register', { root });
    assert.equal(res.status, 200);
    let registry = JSON.parse(await readFile(path.join(dir, 'data', 'registry.json'), 'utf8'));
    assert.equal(registry.projects[normRoot].vcs.type, 'p4');
    assert.equal(registry.projects[normRoot].lastSeen > 0, true);

    // 项目列表携带 vcs 标识
    const projects = await (await fetch(url + '/api/projects')).json();
    assert.equal(projects.find((p) => p.root === normRoot).vcs.type, 'p4');

    // 映射变化后 init 刷新缓存
    setSpec({ mapped: false });
    res = await post('/api/init', { root });
    assert.equal(res.status, 200);
    registry = JSON.parse(await readFile(path.join(dir, 'data', 'registry.json'), 'utf8'));
    assert.deepEqual(registry.projects[normRoot].vcs.type, null);

    // 服务器不可达：不报错、不覆写既有缓存
    setSpec({ offline: true });
    res = await post('/api/init', { root });
    assert.equal(res.status, 200);
    registry = JSON.parse(await readFile(path.join(dir, 'data', 'registry.json'), 'utf8'));
    assert.deepEqual(registry.projects[normRoot].vcs.type, null);
    setSpec({ mapped: true });

    // init 响应携带 created（结构缺失时惰性补齐）
    const initRes = await post('/api/init', { root });
    const initBody = await initRes.json();
    assert.ok(Array.isArray(initBody.created));

    // /api/vcs/add：kanban/ 子树内成功
    const innerFile = path.join(root, 'kanban', 'probe.txt');
    await writeFile(innerFile, 'probe');
    res = await post('/api/vcs/add', { root, files: ['kanban/probe.txt'] });
    assert.equal(res.status, 200);

    // 越界路径：整体拒绝且不执行任何 p4 操作
    const callsBefore = (await shimLog(logFile)).length;
    res = await post('/api/vcs/add', { root, files: ['kanban/ok.txt', '../evil.txt'] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /越界/);
    assert.equal((await shimLog(logFile)).length, callsBefore); // 之后无任何 p4 调用

    // 非 P4 受管项目：add 拒绝
    const plainRoot = await tempRoot(t);
    res = await post('/api/vcs/add', { root: plainRoot, files: ['kanban/x.txt'] });
    assert.equal(res.status, 409);
    const outsiderRoot = path.join(root, 'outsider').replace(/\\/g, '/');
    res = await post('/api/vcs/add', { root: outsiderRoot, files: ['kanban/x.txt'] });
    assert.equal(res.status, 409);
  });
});

test('非 P4 项目写接口零 p4 调用（服务端全链路）', async (t) => {
  const root = await tempRoot(t);
  const logFile = path.join(root, 'zero-shim.log');
  const setSpec = useShim(t, { mapped: true }, logFile); // 即使 shim 存在，非 P4 缓存下也不得调用

  await withServer(t, async ({ url }) => {
    const post = (p, body) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await post('/api/register', { root }); // 首次检测为受管：-V, where
    setSpec({ mapped: false });
    await post('/api/init', { root });     // 刷新为非 P4：-V, where
    const callsAfterInit = (await shimLog(logFile)).map((c) => c[0]);
    assert.deepEqual(callsAfterInit, ['-V', 'where', '-V', 'where']);

    const created = await (await post('/api/threads', { root, title: 'Z', slug: 'thread-z' })).json();
    assert.equal(created.id, '0001-thread-z');
    await post('/api/active-thread', { root, id: created.id });
    await post('/api/thread/status', { root, id: created.id, status: '实现' });
    const calls = await shimLog(logFile);
    assert.deepEqual(calls.map((c) => c[0]), ['-V', 'where', '-V', 'where']); // 写路径零 p4 调用
  });
});
