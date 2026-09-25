# 看板可视化

status: 实现

## 目标

在已有看板交付物的基础上实现看板的可视化，提供人类可读可操作的看板页面

## 已完成的工作

- 2026-09-25：前端形态探索（openspec-explore）。结论：方案一（插件嵌入 kimi-code 窗口 UI）不可行；选定方案二——插件 hooks 驱动无窗口本地 Web 服务。已产出：多项目架构（单服务 + 注册表）、入口（`/kanban:open` 斜杠命令）、首版范围（仅显示 active thread 原文）、服务常驻策略，以及一份"验证桌面端是否触发 hooks"的测试 prompt（待交给另一个 agent 执行）。
- 2026-09-25：完成"验证桌面端是否触发 hooks"实验（探针写日志法，已清理）。结论：**桌面端（Windows）触发 `SessionStart` 与 `SessionHeartbeat`，不触发 `SessionEnd`**（托盘彻底退出、关闭会话两条退出路径实测均无记录，已排除探针/路径问题——同一探针在退出前后均正常捕获其他事件）。关键细节：
  - 启动 App 自动恢复上次会话**会**触发 `SessionStart`，但 `source=resume` 而非 `startup`；`startup` 全实验未观察到（推测仅无历史可恢复时出现，对方案二无影响——两条路径都是 SessionStart）。
  - `SessionHeartbeat` 严格每 60s 一条，带 `uptime_ms`（自本次 resume 起锚）。
  - payload 含 `client_type:"kimi_code_desktop"`、`session_id`、`cwd`、`model`、`session_title`；会话重命名后 `session_title` 实时更新。
  - `cwd` 为 hook 触发时所在项目路径，可用于注册表定位项目。
- 2026-09-25：add-kanban-viewer 实施，任务 1.1–3.2 全部完成并逐项验证通过（健康检查、注册表排序/持久化/损坏兜底、TTL 自杀约 211s 后端口释放、active-thread 三态、静态托管、ensure 幂等拉起、heartbeat 静默 fail-open、前端带参/无参/下拉切换/无活跃线程提示，前端用桌面端内置浏览器面板实测）。5.1 通过：用户重启 App 后服务被 hook 自动拉起，注册表含本项目。
- 2026-09-25：实测结论——**桌面端不派发插件 `commands` 注册的斜杠命令**（`/plugins info` 计数正常，但命令不进补全列表、回车不注入命令体；无上下文项目中 Agent 对 `/kanban:open` 无感知）。已新增 `skills/kanban-open/SKILL.md` 作为桌面端入口，command 保留供 CLI。
- 2026-09-25：OpenSpec change `add-kanban-viewer` 完成并归档（→ `openspec/changes/archive/2026-09-25-add-kanban-viewer`），delta spec 同步生成主 spec `openspec/specs/kanban-viewer/spec.md`。蒸馏：动机——为看板提供 active thread 可视化页面，用户无需手动维护后台进程；关键决定——全局单服务 + 项目注册表、TTL=180s 自杀、桌面端入口改用 skill；完成情况——proposal/specs/design/tasks 全部完成（14/14 任务），实现逐项实测通过，主 spec 通过 `openspec validate --strict`。

## 决策

- **决定**：否决方案一（以插件形式嵌入 kimi-code 窗口，提供侧边栏按钮/webview）。
  **原因**：官方插件 API 无 UI 扩展点，manifest 仅支持 skills/agents/commands/mcpServers/hooks/systemPrompt 等贡献；UI 相关字段（tools/apps/inject 等）会被诊断并忽略。
- **决定**：采用方案二——kimi-code 插件 + `SessionStart` hook 启动无窗口本地 Web 服务，托管看板前端。
  **原因**：hook 的 stdin JSON 带 `cwd`，可定位项目；detached + windowsHide 满足"无终端窗口"的偏好；`SessionStart(startup/resume)` 同时覆盖新建会话与恢复历史会话。
- **决定**：架构定为全局单服务（固定端口）+ 项目注册表（`registry.json`，root→lastSeen），多项目共用一个进程；入口为斜杠命令 `/kanban:open`，由 Agent 打开带 `?root=` 的 URL。
  **原因**：避免每项目一进程一端口；单书签可用；hook 注册 cwd 天然支持多项目。
- **决定**：首版前端只显示当前 active thread 的 `thread.md` 原文（`<pre>`），不做渲染与操作。
  **原因**：用户明确"只要能显示 md 文件原文就行"，先打通链路。
- **决定**：服务生命周期采用 TTL 自杀策略——`SessionHeartbeat` 停 3 分钟（TTL=180s，心跳间隔 3 倍）后服务自动退出；插件只配 `SessionStart` + `SessionHeartbeat` 两条 hook，不配 SessionEnd。
  **原因**：用户偏好干净、不留常驻进程（2026-09-25 明确"还是清理一下，干净一点"）；TTL 为心跳间隔 3 倍不会误杀，误杀也可由下次 `SessionStart` 幂等复活；`SessionEnd` 桌面端实测不触发，TTL 自杀是唯一可靠的清理机制。
- **决定**：确认方案二核心链路（`SessionStart` hook 启动看板服务）在桌面端可行，按原设计推进。
  **原因**：2026-09-25 实测 `client_type:"kimi_code_desktop"` 触发 `SessionStart(source=resume)` 与 `SessionHeartbeat`（严格 60s），payload.cwd 可定位项目；TTL 清理不依赖 SessionEnd，与其在桌面端不触发的实测结果天然兼容。
- **决定**：桌面端入口改用插件 skill（`skills/kanban-open`），`commands/open.md` 保留供 CLI 使用。
  **原因**：2026-09-25 实测桌面端不派发插件 commands——`/plugins info kanban` 正常计数 1 个命令，但 `/kanban:open` 不进补全列表、回车不注入命令体（无上下文项目中 Agent 对该指令无感知）；官方文档承诺的"未匹配斜杠输入作为普通消息发给 Agent"行为意味着桌面端最多只能传指令文本，无法传命令体。插件 skill 在桌面端确定可用（三个官方插件均以 skill 暴露）。

## Changes

- add-kanban-viewer
