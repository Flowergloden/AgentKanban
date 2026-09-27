# Proposal

## Why

插件启用状态下覆盖安装必报 Windows EBUSY：官方行为是插件 hook 以插件根目录为工作目录运行，而看板服务进程经 `ensure.mjs` spawn 时继承了该目录作为自己的工作目录，导致托管目录被运行中的服务进程钉死。v0.2.1 因此把更新路径定为"先杀服务进程再重装"，但用户没有好用的杀进程手段，操作繁琐——杀进程只是治标，锁的根因可以在代码里一行根治。

## What Changes

- `ensure.mjs` 拉起服务进程时显式指定工作目录到插件托管目录之外（如系统临时目录），使运行中的服务不再锁住托管目录，覆盖安装无需先杀进程。
- 服务 `/api/health` 健康检查响应携带服务自身版本号（启动时读取 manifest）。
- 服务新增 `POST /api/shutdown` 端点：响应后自行退出（仅监听 127.0.0.1，与既有心跳 TTL 退出机制并存）。
- `ensure.mjs` 复用既有服务前比对运行中服务版本与自身插件版本：不一致时先经 shutdown 端点停掉旧版，再拉起新版（版本换代），解决重装后旧代码被新心跳续命常驻的问题。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `kanban-viewer`: 服务拉起行为增加"不得钉住插件托管目录"约束；服务复用逻辑增加版本一致性判断与换代行为；新增 shutdown 端点与版本化健康检查的要求。

## Impact

- 代码：`viewer/server/ensure.mjs`（spawn cwd、版本比对与换代流程）、`viewer/server/server.mjs`（health 携带版本、新增 shutdown 端点）。
- 兼容性：旧版服务无 shutdown 端点与版本字段，新版 ensure 对"版本未知"的旧服务 SHALL 按版本不一致处理——旧服务无 shutdown 能力时退出请求失败，ensure 退化为直接复用（维持现状行为，更新仍需手动杀进程，仅本次升级如此）。
- 发布：随 v0.2.2 发布；release notes 的更新路径说明随之改写为"直接重装恒定 latest URL，无需杀进程"。
- 不影响心跳 TTL 自动退出、多项目注册表等既有行为。
