import test from 'node:test';
import assert from 'node:assert/strict';
import { createExternalSync } from '../web/external-sync.js';

// 假 DOM 环境：可切换可见性、手动派发事件、手动推进间隔计时器
function makeEnv({ visible = true } = {}) {
  const handlers = { visibilitychange: [], focus: [] };
  const doc = {
    visibilityState: visible ? 'visible' : 'hidden',
    addEventListener: (name, fn) => handlers[name]?.push(fn),
    removeEventListener: (name, fn) => { handlers[name] = (handlers[name] || []).filter((f) => f !== fn); },
  };
  const win = {
    addEventListener: (name, fn) => handlers[name]?.push(fn),
    removeEventListener: (name, fn) => { handlers[name] = (handlers[name] || []).filter((f) => f !== fn); },
  };
  const timers = [];
  return {
    doc, win, handlers,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => {},
    tick: () => { for (const t of timers) t.fn(); },
    emit: (name) => { for (const fn of handlers[name] ?? []) fn(); },
  };
}

const deferred = () => {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
};
const nextTick = () => new Promise((res) => setTimeout(res, 0));

test('可见页面按 2500ms 间隔检查，且单在途不并发', async () => {
  const env = makeEnv();
  const gens = [];
  const d1 = deferred();
  let call = 0;
  const sync = createExternalSync({
    check: (gen) => {
      call += 1;
      gens.push(gen);
      return call === 1 ? d1.promise : Promise.resolve();
    },
    intervalMs: 2500,
    setInterval: env.setInterval,
    clearInterval: env.clearInterval,
    document: env.doc,
    window: env.win,
  });
  env.tick(); // 第一次触发，挂起
  env.tick(); // 第二次触发：在途中，必须被跳过
  assert.equal(call, 1, '单在途读取');
  d1.resolve();
  await nextTick();
  env.tick();
  assert.equal(call, 2, '落地后可再次检查');
  assert.deepEqual(gens, [0, 0]);
  sync.destroy();
});

test('隐藏页面暂停检查：不触发读取且间隔计时器不再驱动', async () => {
  const env = makeEnv();
  let calls = 0;
  const sync = createExternalSync({
    check: () => { calls += 1; return Promise.resolve(); },
    intervalMs: 2500,
    setInterval: env.setInterval,
    clearInterval: env.clearInterval,
    document: env.doc,
    window: env.win,
  });
  env.doc.visibilityState = 'hidden';
  env.emit('visibilitychange');
  env.tick();
  assert.equal(calls, 0, '隐藏时不读取');
  sync.destroy();
});

test('恢复可见与获得焦点时立即检查', async () => {
  const env = makeEnv({ visible: false });
  let calls = 0;
  const sync = createExternalSync({
    check: () => { calls += 1; return Promise.resolve(); },
    intervalMs: 2500,
    setInterval: env.setInterval,
    clearInterval: env.clearInterval,
    document: env.doc,
    window: env.win,
  });
  assert.equal(calls, 0);
  env.doc.visibilityState = 'visible';
  env.emit('visibilitychange');
  await nextTick();
  assert.equal(calls, 1, '恢复可见立即检查');
  env.emit('focus');
  await nextTick();
  assert.equal(calls, 2, '聚焦立即检查');
  sync.destroy();
});

test('切换 root/线程后 invalidate 递增代次，旧响应可被判别忽略', async () => {
  const env = makeEnv();
  const seen = [];
  const sync = createExternalSync({
    check: (gen) => { seen.push(gen); return Promise.resolve(); },
    intervalMs: 2500,
    setInterval: env.setInterval,
    clearInterval: env.clearInterval,
    document: env.doc,
    window: env.win,
  });
  env.tick();
  await nextTick();
  sync.invalidate(); // 模拟切换线程/项目
  env.tick();
  await nextTick();
  assert.deepEqual(seen, [0, 1], '检查拿到递增后的代次，旧代次响应由调用方忽略');
  assert.equal(sync.getGeneration(), 1);
  sync.destroy();
});

test('隐藏时 visibilitychange 不触发读取；destroy 后事件与计时器全部停用', async () => {
  const env = makeEnv();
  let calls = 0;
  const sync = createExternalSync({
    check: () => { calls += 1; return Promise.resolve(); },
    intervalMs: 2500,
    setInterval: env.setInterval,
    clearInterval: env.clearInterval,
    document: env.doc,
    window: env.win,
  });
  sync.destroy();
  env.doc.visibilityState = 'hidden';
  env.emit('visibilitychange');
  env.doc.visibilityState = 'visible';
  env.emit('visibilitychange');
  env.emit('focus');
  env.tick();
  await nextTick();
  assert.equal(calls, 0);
  assert.deepEqual(env.handlers.visibilitychange, [], '移除 visibilitychange 监听');
  assert.deepEqual(env.handlers.focus, [], '移除 focus 监听');
});

test('check 抛错不中断轮询', async () => {
  const env = makeEnv();
  let calls = 0;
  const sync = createExternalSync({
    check: () => { calls += 1; return calls === 1 ? Promise.reject(new Error('读取失败')) : Promise.resolve(); },
    intervalMs: 2500,
    setInterval: env.setInterval,
    clearInterval: env.clearInterval,
    document: env.doc,
    window: env.win,
  });
  env.tick();
  await nextTick();
  env.tick();
  await nextTick();
  assert.equal(calls, 2, '失败后继续轮询');
  sync.destroy();
});
