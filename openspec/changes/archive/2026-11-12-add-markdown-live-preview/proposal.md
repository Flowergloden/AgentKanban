# Proposal

## Why

当前便签、线程小节和新建目标都以原文编辑框与独立预览栏并列展示，重复占用空间并要求用户在两个区域之间切换视线。需要在保留 Markdown 原文、自动保存和外部合并语义的前提下，将普通编辑升级为单一界面内同步渲染的 Live Preview。

## What Changes

- 为便签、线程全部可编辑小节和新建线程目标提供统一的源码驱动 Live Preview：光标所在区块保留 Markdown 标记，非当前区块显示安全渲染结果。
- 保留可点击任务清单，并提供源码模式与渲染失败回退，确保精确编辑和异常场景可用。
- 复用现有草稿状态、防抖自动保存、文件指纹、三方合并及任务原文定位，不引入 HTML 到 Markdown 的往返序列化。
- 普通编辑状态移除独立预览栏；冲突状态继续并列展示本地草稿与外部只读版本，`## 依赖` 的只读专用链接视图保持不变。
- 引入适配无构建静态前端的编辑器资源，补充发行白名单、自动化测试与真实浏览器验收。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `kanban-viewer`: 新增统一 Markdown Live Preview 编辑表面及其原文保真、交互和程序化更新要求；既有即时预览、自动保存、安全渲染和冲突处理要求继续适用。

## Impact

- 主要影响 `viewer/web/` 的编辑组件、线程详情、便签与新建目标界面及样式。
- 新增编辑器相关 vendored 静态资源与许可证，并更新 `scripts/release.mjs` 的三宿主发行资源清单。
- 复用现有 `document-sync.js`、`markdown.js`、`markdown-preview.js` 和 `markdown-merge.js`；服务端 API、Markdown 文件格式、指纹协议与数据目录不变，无需迁移。
- 需要扩充前端单元测试、发行测试和 `docs/manual-acceptance.md` 的真实浏览器验收记录。
