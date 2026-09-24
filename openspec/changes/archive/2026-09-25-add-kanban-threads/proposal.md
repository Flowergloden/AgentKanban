# Proposal

## Why

AI 辅助开发中，一个笼统目标（实现某模块、验证某想法）往往要跨越多个会话、多个 OpenSpec change 才能达成，而会话间的上下文是易逝的：Agent 每次会话都要"重新入职"，人类也缺少一处能总览项目当前节点与目标的地方。OpenSpec 覆盖了单个 change 的规格与生命周期，但缺少承载"跨会话、跨 change 目标"的层。项目刚起步，正是引入这一层的最佳时机。

## What Changes

- 新增独立的 `kanban/` 目录作为线程层的单一事实来源（SSOT），不侵入 OpenSpec 内部目录结构
- 引入"线程（Thread）"概念：一个笼统目标（如实现某模块、某原型）的持久容器，按名字引用 1:N 个 OpenSpec change
- 线程生命周期：`立项 → 规划 → 实现 → 完成`，状态流转由用户手动维护
- 线程卷宗（`thread.md`）至少包含：目标（创建时用户填写）、已完成的工作、决策（决定 + 原因）
- `kanban/current` 指针文件标识当前活跃线程
- 在 `AGENTS.md` 中加入常驻约定：会话开始读取当前线程卷宗并与用户校准；对话出现拐点（方向被否决、想法验证出结论、影响目标的决定、线程搁置/重启）时询问用户是否记入卷宗；archive 完成后将归档 change 的信息蒸馏到所属线程卷宗
- 在 `openspec/config.yaml` 中增加 `operations.archive.guidance`，通过 OpenSpec 官方配置扩展点（不修改技能文件）提示归档后更新线程卷宗
- 新增 `kanban/README.md` 操作文档，告知用户如何手动创建、激活、记录、流转线程
- 本阶段不实现任何 CLI / Web 渲染工具，纯文件 + 约定

## Capabilities

### New Capabilities

- `kanban-threads`: 跨会话线程管理——以文件形式持久承载项目目标、进展与决策，为人类提供可读的项目节点信息，为 Agent 提供会话启动上下文与记录约定

### Modified Capabilities

（无）

## Impact

- 新增：`kanban/` 目录（`README.md`、`current`、`templates/thread.md`、`threads/`）
- 修改：项目根 `AGENTS.md`（新增常驻约定）、`openspec/config.yaml`（新增 `operations.archive.guidance`）
- 不修改 OpenSpec 技能文件与 CLI；当前无现有 specs/changes，无冲突
- 无代码实现、无外部依赖
