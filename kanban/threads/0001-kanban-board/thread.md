# 搭建线程看板

status: 完成

## 目标

搭建本项目的线程看板（`kanban/`）层：以纯文件形式持久承载跨会话、跨 OpenSpec change 的笼统目标，为人类提供可读的项目节点信息，为 Agent 提供会话启动上下文与记录约定。本阶段零代码、零外部依赖，不修改 OpenSpec 技能文件与 CLI。

## 已完成的工作

- 2026-09-25：完成线程看板的方案设计（见 change `add-kanban-threads` 的 proposal/design）：确定目录结构、卷宗模板、生命周期四态与 Agent/人类双侧界面。
- 2026-09-25：归档 change `add-kanban-threads`（delta spec 已同步至主规格树 `openspec/specs/kanban-threads/`）。动机：OpenSpec 覆盖单 change 的生命周期，缺少承载跨会话、跨 change 笼统目标的层，线程层补此空白。关键决定（已同步于上方 `## 决策`）：线程层放独立 `kanban/` 目录、按 change 名字松耦合引用；线程与 change 为 1:N 包含关系，状态四态手动流转；归档蒸馏走 `operations.archive.guidance` + `AGENTS.md` 双 prompt 层，不修改技能文件；非归档拐点由 Agent 询问记录而非全自动。完成情况：8/8 任务全部完成——建成 `kanban/` 目录结构与卷宗模板（`kanban/current`、`kanban/templates/thread.md`）、写入 `AGENTS.md` 三条常驻约定与 `openspec/config.yaml` 的 archive guidance、完成 `kanban/README.md` 操作文档，并完成端到端自举验证（第一条线程 `0001-kanban-board` 已创建并激活）。

## 决策

- **决定**：线程层放在独立目录 `kanban/`，按 change 名字松耦合引用，不放入 `openspec/threads/`。
  **原因**：OpenSpec CLI 不认识 openspec/ 内的自定义目录，未来 validate/archive 行为可能与之冲突；独立目录职责分离干净，将来替换底层工作流线程层也不受影响。
- **决定**：线程与 change 是 1:N 包含关系，线程状态不从 change 状态自动推导。
  **原因**：线程是笼统目标的容器，change 是容器内的一次任务；"目标是否达成"本质是人的判断，自动推导容易产生错误信号。
- **决定**：归档蒸馏走 `operations.archive.guidance` + `AGENTS.md` 双 prompt 层，不修改 OpenSpec 技能文件。
  **原因**：修改技能文件会在技能升级时丢失修改；guidance 为 advisory 性质保证归档永不被阻塞，AGENTS.md 常驻约定兜底老版本技能。
- **决定**：非归档拐点由 Agent 询问用户是否记录，而非全自动记录。
  **原因**：全自动记录不可靠且打扰心流；明确拐点询问加防抖约束（不每轮问、用户拒绝后不追问同一事件）兼顾覆盖与体验。

## Changes

- add-kanban-threads
