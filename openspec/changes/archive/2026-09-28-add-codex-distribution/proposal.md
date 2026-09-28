# Proposal

## Why

AgentKanban 当前仅有 Kimi 插件分发，常驻约定、服务生命周期和安装路径均与该宿主绑定，Codex 用户无法获得同等的看板工作流。新增 Codex 版本时，需要以活动驱动保活替代对会话心跳的强依赖，并提供用户显式选择的常驻启动入口。

## What Changes

- 共用看板服务、前端、线程文件格式和约定正文，提供独立的 Kimi / Codex 宿主适配与分发产物；保留 Kimi 原附件名称和既有入口。
- 新增 Codex 仓库 marketplace、插件清单、生命周期 hooks 和技能入口；通过 SessionStart 注入约定，说明 hooks 审核信任与安装后新会话验证流程。
- **BREAKING（生命周期语义）**：默认自动模式由会话活动、Kimi 心跳和可见看板页面活动续期，超过 180 秒无活动后退出；Codex 闲置聊天仍然打开不构成保活保证，后续活动或打开入口可重新启动。
- 增加常驻启动、取消常驻、状态查询、显式停止入口；提供独立于 Agent 的脚本入口。常驻模式跳过空闲退出，普通打开不改变模式，取消常驻重置空闲计时；不包含开机自启或崩溃自动重启。
- 抽离宿主无关的版本和用户级注册表；增加跨宿主复用、协议兼容判断及保留运行模式的升级换代，避免双方反复替换服务。
- 增加运行模式展示、安装/升级说明和分发包及生命周期验收。

## Capabilities

### New Capabilities

- `plugin-distribution`: Kimi 与 Codex 双宿主插件的打包、marketplace 安装、版本一致性和升级迁移契约。

### Modified Capabilities

- `kanban-viewer`: 扩展宿主接入、约定注入、启动与复用、活动驱动退出、显式常驻、服务控制、注册表迁移及打开入口。
- `kanban-threads`: 将常驻约定载体从仅 systemPrompt 扩展为宿主支持的会话上下文注入，保留四条约定及项目守卫。

## Impact

- 实现涉及 viewer 的服务启动/心跳/HTTP 层、共享版本元数据、Web 状态展示、SYSTEM.md、skills、Kimi manifest/commands，以及新增 Codex manifest/hooks；不复制或改写线程业务模型。
- 发布涉及 .github/workflows/release.yml、新增仓库 marketplace 和包清单校验；新增安装说明，不修改 OpenSpec 技能或用户全局配置。
- HTTP 健康检查将增加协议与运行模式信息；新增活动上报和模式控制，保留旧 heartbeat 端点适配 Kimi。注册表从 Kimi 专属目录非破坏性导入共享目录。
- 两端同机共存的完整保障以均升级至支持新协议的版本为前提；旧客户端无法由新服务远程修复，需明确迁移步骤。
- 首版以 Windows 本地 Codex 桌面端与 CLI 为验收目标；保留既有 Node.js 运行方式，不引入 MCP、系统服务或新运行时依赖。Linux/macOS、云端及官方公共插件目录上架不属于本次验收范围。
