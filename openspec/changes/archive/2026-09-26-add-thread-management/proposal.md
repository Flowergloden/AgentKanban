# Proposal

## Why

看板服务首版（add-kanban-viewer）只解决了"看见 active thread 原文"：用户想知道工作区里有哪些线程、改一句目标、流转一个状态，仍须回到文本编辑器手动操作 `kanban/` 文件。线程的浏览、编辑、创建、删除、激活与状态流转是看板的核心价值，现在把它们做进看板页面，让 `kanban/` 的操作手册动作全部有了图形界面。

## What Changes

- 看板服务对 `kanban/` 从只读升级为读写（**BREAKING**：反转 kanban-viewer spec 中"服务对 `kanban/` 目录 MUST 只读"的约束）——新增线程列表/详情查询与小节更新、status 流转、线程创建/删除、活跃线程切换等接口。
- 并发控制采用乐观并发：读详情返回文件指纹（mtime + 内容 hash），写回时校验，失败返回 409；写盘沿用 tmp+rename 原子写。线程文档写操作离散且低频，不引入锁。
- 前端重写为 Preact + htm（vendored 静态文件，无构建步骤），包含视图标签页、项目切换与线程详情页。
- 三个内置视图：全部线程表格 / 按 status 分组的看板（拖拽换列即流转 status）/ 未完成筛选。用户自定义视图与甘特图、依赖关系图后置（另开线程）。
- 线程详情页按小节授权编辑：`## 目标` 随手可改；`## 决策`、`## 已完成的工作`、`## Changes` 默认只读，点"编辑"解锁；阅读模式保持 markdown 原文显示，不做渲染。
- 线程创建（填标题，服务自动分配 id、生成 slug、套用模板）与删除（真删，git 兜底；删除活跃线程需二次确认，确认后清空 `kanban/current`）。
- 设置/取消活跃线程（写 `kanban/current`）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `kanban-viewer`：服务从对 `kanban/` 只读变为读写（修改"active thread 查询接口"中的只读约束）；新增线程列表、线程详情、小节更新（乐观并发）、status 流转、线程创建/删除、活跃线程切换等接口要求；新增前端三视图与详情分小节编辑的页面要求。

## Impact

- 代码：`viewer/server/server.mjs`（新增线程 CRUD 与活跃切换接口、静态托管扩展、写盘原子化与并发校验；解析逻辑可拆分为同目录新模块）、`viewer/web/`（前端重写，含 `vendor/` 下 vendored preact + htm）。
- API：保留 `/api/health`、`/api/register`、`/api/heartbeat`、`/api/projects`、`/api/active-thread`；新增线程列表/详情/小节更新/status 流转/创建/删除/活跃切换接口。
- 依赖：首次引入 vendored 前端库（preact、htm，合计约 10KB，随 `viewer/` 目录镜像分发）；无 npm 依赖、无构建步骤、无 CDN 引用。
- 兼容性：`kanban/` 文件格式不变（SSOT 仍是 `thread.md` 与 `current`），`kanban/README.md` 的手动操作路径保持有效；乐观并发防止页面与 Agent（按 AGENTS.md 约定追加卷宗）互相覆盖。
- 非目标：用户自定义视图及其持久化、甘特图/依赖关系图、markdown 渲染阅读模式、搜索、`kanban/README.md` 与 `AGENTS.md` 的文档更新（手动操作语义不变）。
