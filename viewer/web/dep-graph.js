import { html, useState, useEffect, useMemo, useRef } from './vendor/preact-standalone.module.js';
import { api } from './api.js';

// 节点尺寸与布局间距（被依赖方在上层，层内横向均布）
const NODE_W = 170;
const NODE_H = 50;
const GHOST_W = 76;
const GHOST_H = 36;
const LAYER_H = 120;
const COL_W = 220;
const PAD = 40;

// 节点底色按 status 着色（与看板四列一致）
const STATUS_COLORS = {
  立项: '#ddf0ff',
  规划: '#fff8c5',
  实现: '#dafbe1',
  完成: '#e7ebf0',
};

// 位置持久化：localStorage，按「项目根+线程标识」键控，不写入 kanban/
const posKey = (root, key) => `kanban-dep-graph:${root.replace(/\\/g, '/')}:${key}`;

function loadManualPositions(root) {
  const prefix = posKey(root, '');
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(prefix)) continue;
    try {
      const p = JSON.parse(localStorage.getItem(k));
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[k.slice(prefix.length)] = p;
    } catch {
    }
  }
  return out;
}

// 图模型派生：实体节点 + 悬空序号的幽灵节点；边由列表接口 deps 派生（A.deps 含 B 序号即 A→B）
function buildModel(threads) {
  const nodes = threads.map((t) => ({
    key: t.id, id: t.id, num: t.id.slice(0, 4), title: t.title,
    status: t.status, active: t.active, ghost: false,
  }));
  const byNum = new Map(nodes.map((n) => [n.num, n]));
  const edges = [];
  const ghostNums = [];
  for (const t of threads) {
    for (const num of t.deps ?? []) {
      const target = byNum.get(num);
      if (target) {
        if (target.key !== t.id) edges.push({ from: t.id, to: target.key, toNum: num });
      } else if (!ghostNums.includes(num)) {
        ghostNums.push(num);
      }
    }
  }
  const ghosts = ghostNums.map((num) => ({ key: `ghost:${num}`, num, ghost: true }));
  for (const t of threads) {
    for (const num of t.deps ?? []) {
      if (!byNum.has(num)) edges.push({ from: t.id, to: `ghost:${num}`, toNum: num });
    }
  }
  return { nodes: [...nodes, ...ghosts], edges };
}

// DFS 检环：返回环路上的节点 key 与边对象集合；成环仅标记不禁止
function findCycles(nodes, edges) {
  const adj = new Map(nodes.map((n) => [n.key, []]));
  for (const e of edges) if (adj.has(e.from) && adj.has(e.to)) adj.get(e.from).push(e);
  const color = new Map(); // 1=在栈上 2=已完成
  const stack = [];
  const cycleNodes = new Set();
  const cycleEdges = new Set();
  const visit = (key) => {
    color.set(key, 1);
    stack.push(key);
    for (const e of adj.get(key)) {
      const c = color.get(e.to) || 0;
      if (c === 0) {
        visit(e.to);
      } else if (c === 1) {
        // 回边：栈上从 e.to 起的路径连同本边构成一个环
        const i = stack.indexOf(e.to);
        for (let j = i; j < stack.length; j++) cycleNodes.add(stack[j]);
        cycleEdges.add(e);
        for (let j = i; j < stack.length - 1; j++) {
          for (const e2 of adj.get(stack[j])) if (e2.to === stack[j + 1]) cycleEdges.add(e2);
        }
      }
    }
    stack.pop();
    color.set(key, 2);
  };
  for (const n of nodes) if (!color.get(n.key)) visit(n.key);
  return { cycleNodes, cycleEdges };
}

// 自动分层：节点深度 = 到叶子（无出边）的最长距离，深度 0 在最上层；成环时打破回边计算
function computeAutoPositions(nodes, edges) {
  const adj = new Map(nodes.map((n) => [n.key, []]));
  for (const e of edges) if (adj.has(e.from) && adj.has(e.to)) adj.get(e.from).push(e.to);
  const depth = new Map();
  const onStack = new Set();
  const dfs = (key) => {
    if (depth.has(key)) return depth.get(key);
    if (onStack.has(key)) return 0; // 回边：打破，避免死循环
    onStack.add(key);
    let d = 0;
    for (const to of adj.get(key)) d = Math.max(d, dfs(to) + 1);
    onStack.delete(key);
    depth.set(key, d);
    return d;
  };
  for (const n of nodes) if (!n.ghost) dfs(n.key);
  // 幽灵节点只有入边：置于其依赖方上一层
  for (const n of nodes) {
    if (!n.ghost) continue;
    let d = Infinity;
    for (const e of edges) if (e.to === n.key) d = Math.min(d, (depth.get(e.from) ?? 1) - 1);
    depth.set(n.key, d === Infinity ? 0 : Math.max(0, d));
  }
  const layers = new Map();
  for (const n of nodes) {
    const d = depth.get(n.key) ?? 0;
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d).push(n.key);
  }
  const pos = {};
  for (const [d, keys] of layers) {
    keys.sort();
    keys.forEach((key, i) => {
      pos[key] = { x: PAD + i * COL_W, y: PAD + d * LAYER_H };
    });
  }
  return pos;
}

// 边端点裁剪：从源矩形边缘连到目标矩形边缘，避免线段穿过节点
function clipEdge(cx, cy, tx, ty, w, h) {
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const sx = dx !== 0 ? (w / 2) / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? (h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

const nodeSize = (n) => (n.ghost ? [GHOST_W, GHOST_H] : [NODE_W, NODE_H]);

export function DepGraphView({ root, threads, onOpen, onChanged }) {
  const [manual, setManual] = useState({});
  const [drag, setDrag] = useState(null); // { key, mode: 'move'|'connect', offX, offY, moved, x, y }
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const svgRef = useRef(null);

  useEffect(() => { setManual(loadManualPositions(root)); setError(''); setConflict(false); }, [root]);

  const { nodes, edges } = useMemo(() => buildModel(threads), [threads]);
  const { cycleNodes, cycleEdges } = useMemo(() => findCycles(nodes, edges), [nodes, edges]);
  const autoPos = useMemo(() => computeAutoPositions(nodes, edges), [nodes, edges]);

  const posOf = (key) => {
    if (drag?.mode === 'move' && drag.key === key) {
      return { x: Math.max(0, drag.x - drag.offX), y: Math.max(0, drag.y - drag.offY) };
    }
    return manual[key] ?? autoPos[key] ?? { x: PAD, y: PAD };
  };

  // 鼠标坐标换算到 SVG 画布坐标
  const toSvg = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrag = (n, mode, e) => {
    e.preventDefault();
    e.stopPropagation();
    const p = toSvg(e);
    const pos = posOf(n.key);
    setDrag({ key: n.key, mode, offX: p.x - pos.x, offY: p.y - pos.y, startX: p.x, startY: p.y, moved: false, x: p.x, y: p.y });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      const p = toSvg(e);
      // 位移超过 4px 才算拖拽，否则原地抬起视为点击
      setDrag((d) => d && {
        ...d, x: p.x, y: p.y,
        moved: d.moved || Math.abs(p.x - d.startX) + Math.abs(p.y - d.startY) > 4,
      });
    };
    const onUp = async (e) => {
      const d = drag;
      setDrag(null);
      const p = toSvg(e);
      if (d.mode === 'move') {
        const nx = Math.max(0, p.x - d.offX);
        const ny = Math.max(0, p.y - d.offY);
        if (d.moved) {
          // 落盘 localStorage（仅浏览器侧，kanban/ 零写入）
          const next = { ...manual, [d.key]: { x: Math.round(nx), y: Math.round(ny) } };
          setManual(next);
          localStorage.setItem(posKey(root, d.key), JSON.stringify(next[d.key]));
        } else if (!d.key.startsWith('ghost:')) {
          onOpen(d.key); // 原地点击：跳转该线程详情
        }
      } else {
        // 连线落点：命中目标实体节点建边；落到自身或空白处取消（无写操作）
        const target = nodes.find((n) => {
          if (n.ghost || n.key === d.key) return false;
          const pos = posOf(n.key);
          const [w, h] = nodeSize(n);
          return p.x >= pos.x && p.x <= pos.x + w && p.y >= pos.y && p.y <= pos.y + h;
        });
        if (target) await addDep(d.key, target.num);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, manual, nodes, root]);

  // 建边：读 A 详情取指纹 → 在 `## 依赖` 净内容末尾追加 B 序号行 → 小节更新接口（缺小节时接口自动补建）→ 刷新图
  const addDep = async (fromId, toNum) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setConflict(false);
    try {
      const detail = await api.getThread(root, fromId);
      const body = (detail.sections['依赖'] ?? '').trim();
      await api.updateSection(root, fromId, '依赖', (body ? body + '\n' : '') + `- ${toNum}`, detail.fingerprint);
      await onChanged();
    } catch (err) {
      if (err.status === 409) setConflict(true);
      else setError(`建立依赖失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // 删边：从 A 的 `## 依赖` 移除对应序号行（点选边后确认）
  const removeDep = async (edge) => {
    if (busy) return;
    if (!window.confirm(`删除依赖：${edge.from} → ${edge.toNum}？`)) return;
    setBusy(true);
    setError('');
    setConflict(false);
    try {
      const detail = await api.getThread(root, edge.from);
      const kept = (detail.sections['依赖'] ?? '').split('\n')
        .filter((l) => l.trim() && l.match(/\d{4}/)?.[0] !== edge.toNum);
      await api.updateSection(root, edge.from, '依赖', kept.join('\n'), detail.fingerprint);
      await onChanged();
    } catch (err) {
      if (err.status === 409) setConflict(true);
      else setError(`删除依赖失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // 画布尺寸随内容（含人工拖出的位置）扩展
  let maxX = 600;
  let maxY = 300;
  for (const n of nodes) {
    const p = posOf(n.key);
    const [w, h] = nodeSize(n);
    maxX = Math.max(maxX, p.x + w + PAD);
    maxY = Math.max(maxY, p.y + h + PAD);
  }

  const nodeByKey = new Map(nodes.map((n) => [n.key, n]));

  return html`
    ${error && html`<div class="banner-409">${error}</div>`}
    ${conflict && html`
      <div class="banner-409">
        <span>文件已被修改（可能被 Agent 更新），本次操作未写入。请刷新后重试。</span>
        <button class="primary" onClick=${() => { setConflict(false); onChanged(); }}>重新加载</button>
      </div>
    `}
    ${edges.length === 0 && html`
      <div class="hint">暂无依赖关系：从节点右侧连接柄拖出连线、落到另一节点即可建立「A 依赖 B」；点选已有连线可删除。拖节点空白处可调整位置（仅存浏览器本地）。</div>
    `}
    <div class="dep-graph-wrap">
      <svg ref=${svgRef} width=${maxX} height=${maxY} style="display:block">
        <defs>
          <marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#57606a"></path>
          </marker>
          <marker id="dep-arrow-cycle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#cf222e"></path>
          </marker>
          <marker id="dep-arrow-temp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#1f6feb"></path>
          </marker>
        </defs>
        ${edges.map((e) => {
          const a = nodeByKey.get(e.from);
          const b = nodeByKey.get(e.to);
          if (!a || !b) return null;
          const pa = posOf(a.key);
          const pb = posOf(b.key);
          const [wa, ha] = nodeSize(a);
          const [wb, hb] = nodeSize(b);
          const acx = pa.x + wa / 2;
          const acy = pa.y + ha / 2;
          const bcx = pb.x + wb / 2;
          const bcy = pb.y + hb / 2;
          const [x1, y1] = clipEdge(acx, acy, bcx, bcy, wa, ha);
          const [x2, y2] = clipEdge(bcx, bcy, acx, acy, wb, hb);
          const inCycle = cycleEdges.has(e);
          const stroke = inCycle ? '#cf222e' : '#57606a';
          return html`
            <g key=${`${e.from}->${e.to}`}>
              ${inCycle && html`<title>依赖成环</title>`}
              <path d=${`M ${x1} ${y1} L ${x2} ${y2}`} stroke=${stroke} stroke-width=${inCycle ? 2.5 : 1.5}
                fill="none" marker-end=${`url(#${inCycle ? 'dep-arrow-cycle' : 'dep-arrow'})`}></path>
              <path d=${`M ${x1} ${y1} L ${x2} ${y2}`} stroke="transparent" stroke-width="12" fill="none"
                style="cursor:pointer" onClick=${() => removeDep(e)}>
                <title>${inCycle ? '依赖成环；' : ''}点击删除依赖 ${e.from} → ${e.toNum}</title>
              </path>
            </g>
          `;
        })}
        ${drag?.mode === 'connect' && (() => {
          const n = nodeByKey.get(drag.key);
          const p = posOf(drag.key);
          const [w, h] = nodeSize(n);
          return html`<path d=${`M ${p.x + w / 2} ${p.y + h / 2} L ${drag.x} ${drag.y}`}
            stroke="#1f6feb" stroke-width="1.5" stroke-dasharray="5 4" fill="none" marker-end="url(#dep-arrow-temp)"></path>`;
        })()}
        ${nodes.map((n) => {
          const p = posOf(n.key);
          const [w, h] = nodeSize(n);
          const inCycle = cycleNodes.has(n.key);
          if (n.ghost) {
            // 悬空序号：dashed 半透明幽灵节点，仅显示序号
            return html`
              <g key=${n.key} class="dep-node" opacity="0.55"
                onMouseDown=${(e) => startDrag(n, 'move', e)}>
                <rect x=${p.x} y=${p.y} width=${w} height=${h} rx="8" fill="#f6f8fa"
                  stroke="#57606a" stroke-width="1.5" stroke-dasharray="5 4"></rect>
                <text x=${p.x + w / 2} y=${p.y + h / 2 + 4} text-anchor="middle" font-size="12" fill="#57606a">${n.num}</text>
                <title>悬空引用：无线程对应序号 ${n.num}</title>
              </g>
            `;
          }
          const title = n.title.length > 9 ? n.title.slice(0, 9) + '…' : n.title;
          return html`
            <g key=${n.key} class="dep-node" onMouseDown=${(e) => startDrag(n, 'move', e)}>
              ${inCycle && html`<title>依赖成环</title>`}
              <rect x=${p.x} y=${p.y} width=${w} height=${h} rx="8"
                fill=${STATUS_COLORS[n.status] ?? '#f6f8fa'}
                stroke=${inCycle ? '#cf222e' : n.active ? '#1a7f37' : '#d0d7de'}
                stroke-width=${inCycle || n.active ? 3 : 1}></rect>
              <text x=${p.x + 10} y=${p.y + 20} font-size="12" fill="#57606a">
                ${n.id}${n.active ? '（活跃）' : ''}
              </text>
              <text x=${p.x + 10} y=${p.y + 38} font-size="13" fill="#1f2328">${title}</text>
              <circle class="dep-handle" cx=${p.x + w} cy=${p.y + h / 2} r="6"
                onMouseDown=${(e) => startDrag(n, 'connect', e)}>
                <title>拖出连线以建立依赖</title>
              </circle>
            </g>
          `;
        })}
      </svg>
    </div>
  `;
}
