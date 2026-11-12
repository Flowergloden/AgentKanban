// 共享 Markdown Live Preview 编辑器：CodeMirror 6 持有唯一原文文档，
// 非活动区块以安全渲染 widget 呈现，活动区块显示可编辑标记。
// 所有 HTML 只能来自 renderMarkdown 成功结果；程序化更新带注解、不进本地历史、不回写 onChange。
import { html, useEffect, useRef, useState } from './vendor/preact-standalone.module.js';
import {
  Annotation, Compartment, Decoration, EditorSelection, EditorState, EditorView, StateField, Transaction,
  WidgetType, defaultHighlightStyle, defaultKeymap, drawSelection, ensureSyntaxTree, history,
  historyKeymap, indentWithTab, keymap, markdown, markdownKeymap, markdownLanguage, placeholder,
  syntaxHighlighting, syntaxTree, undo,
} from './vendor/codemirror.bundle.mjs';
import { renderMarkdown, markdownTaskOffsets } from './markdown.js';
import { mergeDocuments } from './markdown-merge.js';

// 程序化草稿更新（自动合并/采用外部回传）的来源注解：
// 带此注解的事务不回写 onChange、不进入本地撤销历史，避免回声循环。
export const ProgrammaticUpdate = Annotation.define();

// 渲染与 widget 计数：浏览器验收用其验证增量更新（滚动/输入不重复重建未受影响 widget）。
export const liveEditorStats = { blocksRendered: 0, widgetsPlanned: 0, widgetsBuilt: 0 };
export function resetLiveEditorStats() {
  liveEditorStats.blocksRendered = 0;
  liveEditorStats.widgetsPlanned = 0;
  liveEditorStats.widgetsBuilt = 0;
}

// 计算 oldText -> newText 的最小单区间变更（公共前后缀之外的整体替换）。
export function minimalChanges(oldText, newText) {
  const oldStr = String(oldText ?? '');
  const newStr = String(newText ?? '');
  if (oldStr === newStr) return null;
  let prefix = 0;
  const limit = Math.min(oldStr.length, newStr.length);
  while (prefix < limit && oldStr[prefix] === newStr[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldStr.length - prefix
    && suffix < newStr.length - prefix
    && oldStr[oldStr.length - 1 - suffix] === newStr[newStr.length - 1 - suffix]
  ) suffix += 1;
  return [{
    from: prefix,
    to: oldStr.length - suffix,
    insert: newStr.slice(prefix, newStr.length - suffix),
  }];
}

// CodeMirror 文档模型只以 \n 分隔行；原文 CRLF/CR 进编辑器时归一化，
// 回传时按检测到的行尾恢复，保证 CRLF 文件编辑往返零漂移（提交仅含实际内容变更）。
export function toEditorSource(raw) {
  return String(raw ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function detectEol(raw) {
  const text = String(raw ?? '');
  if (text.includes('\r\n')) return '\r\n';
  if (text.includes('\r')) return '\r';
  return '\n';
}

export function fromEditorSource(text, eol) {
  const source = String(text ?? '');
  return eol === '\n' ? source : source.replace(/\n/g, eol);
}

// 程序化值适配：回传值与编辑器文档相同返回 null（零事务）；
// 否则产出带注解事务，选区随变更自动映射（取代旧 textarea mapCursor 效果）。
export function valueTransaction(state, next) {
  const current = state.doc.toString();
  const nextStr = String(next ?? '');
  if (current === nextStr) return null;
  const changes = minimalChanges(current, nextStr);
  return state.update({
    changes,
    annotations: [ProgrammaticUpdate.of(true), Transaction.addToHistory.of(false)],
  });
}

// onChange 通道：本地文档变化（输入、任务点击）统一经此回写；
// 程序化事务（注解）不回写，避免把外部合并结果再次塞回同步控制器形成回声。
export function createOnChangeField(onChange) {
  return StateField.define({
    create: () => null,
    update: (value, tr) => {
      if (tr.docChanged && tr.annotation(ProgrammaticUpdate) == null) {
        onChange(tr.newDoc.toString());
      }
      return null;
    },
  });
}

// ---------------------------------------------------------------------------
// Live Preview 装饰层
// ---------------------------------------------------------------------------

// 参与渲染的顶层区块类型（标题、段落、列表、引用、代码、表格、分隔线、HTML/注释）。
const RENDERABLE_BLOCKS = new Set([
  'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
  'SetextHeading1', 'SetextHeading2', 'Paragraph', 'BulletList', 'OrderedList', 'Blockquote',
  'FencedCode', 'CodeBlock', 'Table', 'HorizontalRule', 'HTMLBlock', 'CommentBlock',
  'ProcessingInstructionBlock',
]);

const HTML_CACHE_LIMIT = 200;
const htmlCache = new Map();
function htmlCacheGet(key) {
  const value = htmlCache.get(key);
  if (value !== undefined) {
    htmlCache.delete(key);
    htmlCache.set(key, value); // LRU  touch
  }
  return value;
}
function htmlCacheSet(key, value) {
  htmlCache.delete(key);
  htmlCache.set(key, value);
  if (htmlCache.size > HTML_CACHE_LIMIT) htmlCache.delete(htmlCache.keys().next().value);
}

export class RenderedBlockWidget extends WidgetType {
  constructor(from, to, htmlText) {
    super();
    this.from = from;
    this.to = to;
    this.htmlText = htmlText;
  }

  eq(other) {
    return other.from === this.from && other.htmlText === this.htmlText;
  }

  toDOM() {
    liveEditorStats.widgetsBuilt += 1;
    const element = document.createElement('div');
    element.className = 'md-live-block';
    element.dataset.blockFrom = String(this.from);
    element.innerHTML = this.htmlText; // 仅 renderMarkdown 成功结果，已清理
    return element;
  }

  ignoreEvent() {
    return false; // 普通点击交给编辑器定位光标（对应行、列表项或复杂块随即转为活动）
  }
}

// 语法树获取：编辑器增量树完整时直接复用；CRLF 文档的增量解析会中途停滞
//（lezer 对 \r\n 的增量断点问题），回退为整篇直解析并按 doc 引用缓存（Text 不可变，
// 同引用即同内容，按键外的更新零解析成本）。
let cachedBlockTree = { doc: null, tree: null };
function blockTreeFor(state) {
  const editorTree = syntaxTree(state);
  if (editorTree.length >= state.doc.length) return editorTree;
  if (cachedBlockTree.doc === state.doc) return cachedBlockTree.tree;
  const tree = markdownLanguage.parser.parse(state.doc.toString());
  cachedBlockTree = { doc: state.doc, tree };
  return tree;
}

function editRangesForBlock(node, doc) {
  if (node.name === 'BulletList' || node.name === 'OrderedList') {
    const items = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'ListItem') items.push({ from: child.from, to: child.to });
    }
    if (items.length) return items;
  }
  if (node.name === 'Paragraph') {
    const lines = [];
    const firstLine = doc.lineAt(node.from).number;
    const lastLine = doc.lineAt(node.to).number;
    for (let number = firstLine; number <= lastLine; number += 1) {
      const line = doc.line(number);
      lines.push({ from: Math.max(node.from, line.from), to: Math.min(node.to, line.to) });
    }
    return lines;
  }
  return [{ from: node.from, to: node.to }];
}

// 纯计算：为 [from, to]（通常为视口）内的非活动可渲染区块规划 widget 装饰。
// 段落按物理行、列表按直接列表项暴露活动原文；其余连续单元合并渲染，保持列表上下文。
// render 可注入；渲染不可用或失败返回 { ok: false, error }，调用方回退源码模式。
export function planBlockWidgets(state, { from = 0, to = state.doc.length, render = renderMarkdown, stats = liveEditorStats } = {}) {
  ensureSyntaxTree(state, state.doc.length, 200);
  const doc = state.doc;
  const ranges = state.selection.ranges;
  const widgets = [];
  const appendWidget = (blockFrom, blockTo) => {
    const text = doc.sliceString(blockFrom, blockTo);
    if (!text.trim()) return { ok: true };
    let htmlText = htmlCacheGet(text);
    if (htmlText === undefined) {
      const result = render(text, { interactiveTasks: true });
      if (!result.ok) return result;
      htmlText = result.html;
      htmlCacheSet(text, htmlText);
      stats.blocksRendered += 1;
    }
    const widget = new RenderedBlockWidget(blockFrom, blockTo, htmlText);
    widgets.push({ from: blockFrom, to: blockTo, decoration: Decoration.replace({ widget, block: true }) });
    stats.widgetsPlanned += 1;
    return { ok: true };
  };
  for (let node = blockTreeFor(state).topNode.firstChild; node; node = node.nextSibling) {
    if (!RENDERABLE_BLOCKS.has(node.name)) continue;
    if (node.to < from || node.from > to) continue;
    const editRanges = editRangesForBlock(node, doc);
    let renderFrom = -1;
    for (let index = 0; index <= editRanges.length; index += 1) {
      const range = editRanges[index];
      const active = range && ranges.some((selection) => selection.from <= range.to && selection.to >= range.from);
      if (range && !active) {
        if (renderFrom < 0) renderFrom = range.from;
        continue;
      }
      if (renderFrom >= 0) {
        const result = appendWidget(renderFrom, editRanges[index - 1].to);
        if (!result.ok) return { ok: false, error: result.error };
        renderFrom = -1;
      }
    }
  }
  return { ok: true, widgets };
}

// 任务 widget 点击：把区块内序号换算为全文档任务序号，返回原文单字符翻转结果。
export function toggleTaskInDoc(text, blockFrom, relIndex) {
  const source = String(text ?? '');
  if (!Number.isInteger(blockFrom) || !Number.isInteger(relIndex) || relIndex < 0) return null;
  const offsets = markdownTaskOffsets(source);
  let base = 0;
  while (base < offsets.length && offsets[base] < blockFrom) base += 1;
  const rawOffset = offsets[base + relIndex];
  if (rawOffset === undefined) return null;
  const char = source[rawOffset];
  if (!/[ xX]/.test(char)) return null;
  return { rawOffset, nextChar: char === ' ' ? 'x' : ' ', fullIndex: base + relIndex };
}

// Live Preview 扩展（包进 Compartment 以便源码模式整体停用，不替换文档、不重建编辑器）。
// 装饰由 StateField 提供（EditorView.decorations.from）：跨行替换装饰不允许来自
// ViewPlugin（CM 对动态装饰禁止 block 效果），StateField 装饰则与代码折叠同级、允许跨行。
export function livePreviewExtensions({ render = renderMarkdown, onError = () => {}, stats = liveEditorStats } = {}) {
  let lastError = null;
  const reportError = (error) => {
    if (error === lastError) return;
    lastError = error;
    onError(error);
  };
  const compute = (state) => {
    const plan = planBlockWidgets(state, { render, stats });
    if (!plan.ok) {
      reportError(plan.error);
      return Decoration.none;
    }
    reportError(null);
    return Decoration.set(plan.widgets.map((widget) => widget.decoration.range(widget.from, widget.to)));
  };
  const decorationsField = StateField.define({
    create: (state) => compute(state),
    update: (value, tr) => {
      if (tr.docChanged || tr.selection) return compute(tr.state);
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  return [
    decorationsField,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const input = event.target?.closest?.('input[data-task-index]');
        if (!input || !view.dom.contains(input)) return false;
        const blockElement = input.closest('[data-block-from]');
        const blockFrom = Number(blockElement?.dataset.blockFrom);
        const outcome = toggleTaskInDoc(view.state.doc.toString(), blockFrom, Number(input.dataset.taskIndex));
        if (!outcome) return false;
        event.preventDefault();
        view.dispatch({
          changes: { from: outcome.rawOffset, to: outcome.rawOffset + 1, insert: outcome.nextChar },
          userEvent: 'input.task-toggle',
        });
        return true;
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// 无头会话：Node 单测以 EditorState 驱动同一套扩展，验证挂载/更新/卸载语义
// ---------------------------------------------------------------------------

export function createEditorSession({ value = '', onChange = () => {}, render = renderMarkdown, live = true } = {}) {
  const compartment = new Compartment();
  let state = EditorState.create({
    doc: String(value ?? ''),
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      compartment.of(live ? livePreviewExtensions({ render }) : []),
      createOnChangeField((text) => onChange(text)),
    ],
  });
  return {
    get state() { return state; },
    get value() { return state.doc.toString(); },
    input(changes) { state = state.update({ changes, userEvent: 'input' }).state; },
    select(pos) { state = state.update({ selection: EditorSelection.cursor(pos) }).state; },
    applyValue(next) {
      const tr = valueTransaction(state, next);
      if (tr) state = tr.state;
      return tr;
    },
    setLive(on) {
      state = state.update({
        effects: compartment.reconfigure(on ? livePreviewExtensions({ render }) : []),
      }).state;
    },
    undo() {
      let applied = false;
      const result = undo({ state, dispatch: (tr) => { state = tr.state; applied = true; } });
      return applied || result;
    },
    destroy() { state = null; },
  };
}

// ---------------------------------------------------------------------------
// Preact 组件
// ---------------------------------------------------------------------------

export function MarkdownLiveEditor({ value, onChange, className = '', placeholder: placeholderText = '', autoFocus = false }) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const compartmentRef = useRef(null);
  const pendingRemoteRef = useRef(null); // IME 组合期间暂存的外部草稿（编辑器空间）{ base, remote }
  const eolRef = useRef(detectEol(value)); // 原文行尾，回传时恢复
  const propsRef = useRef({ value, onChange });
  propsRef.current = { value, onChange };
  const [mode, setMode] = useState('live');
  const [renderError, setRenderError] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const compartment = new Compartment();
    const liveExtensions = livePreviewExtensions({ onError: (error) => setRenderError(error ?? '') });
    const state = EditorState.create({
      doc: toEditorSource(propsRef.current.value),
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
        keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        compartment.of(liveExtensions),
        createOnChangeField((text) => propsRef.current.onChange?.(fromEditorSource(text, eolRef.current))),
        placeholderText ? placeholder(placeholderText) : [],
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    compartmentRef.current = { compartment, liveExtensions };

    // IME 保护：组合输入期间不回填外部草稿；组合结束后以编辑器旧文为基准二次三方合并
    const handleCompositionEnd = () => {
      const pending = pendingRemoteRef.current;
      pendingRemoteRef.current = null;
      if (!pending || !viewRef.current) return;
      const current = view.state.doc.toString();
      const merged = mergeDocuments(pending.base, current, pending.remote);
      const next = merged.conflict ? current : merged.content;
      if (next !== current) {
        const tr = valueTransaction(view.state, next);
        if (tr) view.dispatch(tr);
      }
    };
    view.contentDOM.addEventListener('compositionend', handleCompositionEnd);
    if (autoFocus) view.focus();

    return () => {
      view.contentDOM.removeEventListener('compositionend', handleCompositionEnd);
      view.destroy();
      viewRef.current = null;
      compartmentRef.current = null;
    };
  }, []);

  // 受控值适配：相同回传值零事务；组合输入期间暂存外部草稿（均为编辑器空间文本）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const raw = String(value ?? '');
    eolRef.current = detectEol(raw);
    const next = toEditorSource(raw);
    if (next === view.state.doc.toString()) return;
    if (view.compositionStarted) {
      pendingRemoteRef.current = { base: view.state.doc.toString(), remote: next };
      return;
    }
    const tr = valueTransaction(view.state, next);
    if (tr) view.dispatch(tr);
  }, [value]);

  // 源码模式：同一 EditorView 上经 Compartment 启停装饰层，文档与选区不动
  useEffect(() => {
    const view = viewRef.current;
    const bundle = compartmentRef.current;
    if (!view || !bundle) return;
    view.dispatch({
      effects: bundle.compartment.reconfigure(mode === 'live' ? bundle.liveExtensions : []),
    });
  }, [mode]);

  return html`
    <div class=${'md-live ' + (className || '')} data-mode=${mode}>
      <div class="md-live-bar">
        <button type="button" class="md-live-mode" onClick=${() => setMode(mode === 'live' ? 'source' : 'live')}>
          ${mode === 'live' ? '源码' : '预览'}
        </button>
        ${renderError && html`<span class="md-live-error">Markdown 渲染不可用：${renderError}；已回退为可编辑源码，草稿不会丢失。</span>`}
      </div>
      <div class="md-live-host" ref=${hostRef}></div>
    </div>
  `;
}
