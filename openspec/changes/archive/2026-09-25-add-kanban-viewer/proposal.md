# Proposal

## Why

看板线程（`kanban/threads/`）目前是纯文件机制，人类想了解"当前在做什么"只能用编辑器手动翻目录，缺少一个随时可看的可视化页面。已查证 kimi-code 插件 API 没有 UI 扩展点（无法内嵌侧边栏按钮/webview），因此需要在窗口之外提供一个同样干净的可视化入口：随会话自动就绪、无终端窗口、退出后不留进程。

## What Changes

- 新增 kimi-code 插件 `kanban`：声明 `SessionStart` 与 `SessionHeartbeat` 两条 hooks，以及 `/kanban:open` 斜杠命令（让 Agent 在浏览器中打开当前项目的看板页）。
- 新增本地无窗口 Web 服务（Node 内置模块实现，零第三方依赖）：全局单进程、固定本地端口，通过项目注册表同时服务多个项目。
- 服务提供 JSON API：健康检查、项目注册（取 hook payload 的 `cwd`）、心跳上报、active thread 查询（读 `kanban/current` → `kanban/threads/<id>/thread.md` 原文）。
- 新增单文件 HTML 前端：仅显示当前 active thread 的 `thread.md` 原文（`<pre>`），支持 `?root=` 定位项目与注册项目间的切换。
- 服务生命周期：随首个会话 `SessionStart` 拉起（detached、无窗口）；`SessionHeartbeat` 停 180s 后自动退出，不留孤儿进程，不依赖桌面端不触发的 `SessionEnd`。

## Capabilities

### New Capabilities

- `kanban-viewer`: 以 kimi-code 插件 hooks 驱动的本地 Web 服务，为一个或多个项目的看板提供 active thread 的可视化页面；服务随会话生灭（拉起幂等、TTL 自杀），对 `kanban/` 目录只读。

### Modified Capabilities

（无）

## Impact

- **新增代码**：仓库内新增 `viewer/` 目录，承载插件 manifest、hook 脚本、服务与前端文件；不改动 `kanban/`、`openspec/` 的任何现有内容。
- **使用前提**：用户需执行一次 `/plugins install <viewer 目录路径>` 安装插件；本机需有 `node` 可执行文件。
- **系统资源**：占用一个本地回环端口；运行时为一个无窗口 Node 进程，会话全部结束后约 3 分钟自动退出。
- **写入面**：仅 `~/.kimi-code/kanban-viewer/registry.json`（项目注册表）；对 `kanban/` 目录严格只读。
