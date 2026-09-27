# Proposal

## Why

线程创建时的 slug 自动生成算法（`slugify`）只支持英文标题：非英文标题（如中文）被剥离全部字符后 fallback 为固定值 `thread`——第一个中文标题线程得到毫无语义的目录名，第二个直接因 slug 冲突创建失败，用户只能手动填写英文 slug。让看板服务直连 LLM 生成 slug 需要给这个零配置、零依赖的本地服务引入凭据与配置，代价与收益不匹配；而 Agent 本身就是 LLM，可以把命名从创建时刻延迟到既有的会话校准时刻完成。

## What Changes

- 创建接口行为调整：slug 留空且标题经 slugify 无产出（非英文标题）时，不再 fallback 为 `thread`，改为以保留标记值 `unnamed-pending` 占位；多个待命名线程由序号前缀天然区分，标记值跳过 slug 冲突检查。
- `unnamed-pending` 成为保留字：调用方显式传它作为创建 slug、或作为重命名目标，均返回错误。
- 新增线程重命名接口 `POST /api/threads/:id/rename`：校验 kebab-case、拒绝保留字、检查 slug 冲突，重命名线程目录；被改名线程为当前活跃线程时同步更新 `kanban/current`。
- 插件常驻约定一（会话校准）扩展：校准发现活跃线程 slug 精确命中 `unnamed-pending` 时，Agent SHALL 自动据卷宗标题（必要时参考 `## 目标`）生成英文 kebab-case slug 并调用重命名接口完成命名——不询问用户、仅命名当前活跃线程，随后在校准复述中报告命名结果。
- 网页创建模态框 slug 输入框提示文案与 `kanban/README.md` 概念文档同步更新。

## Capabilities

### New Capabilities

（无新能力）

### Modified Capabilities

- `kanban-viewer`: 修改 Requirement「线程创建与删除接口」——非英文标题的 slug 占位行为（`thread` fallback 改为 `unnamed-pending` 标记、标记值豁免冲突检查、保留字拒绝）；新增 Requirement「线程重命名接口」。
- `kanban-threads`: 修改 Requirement「Agent 会话启动时读取当前线程」——校准流程并入待命名线程的自动命名步骤（约定一扩展，四条约定总数不变）。

## Impact

- 代码：`viewer/server/threads.mjs`（`create()` 行为调整、新增 `rename()`）、`viewer/server/server.mjs`（新增 rename 路由）、`viewer/web/modals.js`（slug 提示文案）、插件 `viewer/SYSTEM.md`（约定一扩展）、`kanban/README.md`（概念同步）。
- API：新增 `POST /api/threads/:id/rename`；`POST /api/threads` 的自动 slug 生成行为变化（仅影响 slug 留空且标题为非英文的场景）。
- 兼容性：历史已创建的 `xxxx-thread` 目录不受影响，可经 rename 接口手动改名；无新增外部依赖、无新增配置项。
- 归属线程：`0003-ergonomic-improvements`（细节优化）。
