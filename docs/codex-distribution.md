# AgentKanban 双宿主安装、运行与验收（Windows 本地）

本文适用于仓库 marketplace 中的 Codex 兼容插件和原有 Kimi 插件。首版仅以 Windows 本地 Codex 桌面端及 CLI 为目标；云端、Linux/macOS、官方公共插件目录均未认证。

## 前置条件与产物

1. 安装可在终端执行的 Node.js，运行 `node --version` 确认。共享服务用 Node.js 启动，未提供独立可执行文件或系统服务。
2. 获取完整仓库检出；Codex marketplace 是仓库根的 `.agents/plugins/marketplace.json`，其 `kanban` 条目指向 `./viewer`，不是 `.agents/plugins` 下的子目录。插件兼容清单位于 `viewer/.codex-plugin/plugin.json`，hooks 在 `viewer/hooks/hooks.json`。
3. Release 保留 Kimi 附件名 `kanban-plugin.zip`，另提供 `kanban-codex-plugin.zip`。两者是可解压校验的配套归档；**不要把未验证的 ZIP URL 直装当成受支持的安装路径**。Codex 安装使用仓库 marketplace。

## Codex 桌面端安装与信任

1. 在 Codex 桌面端打开此仓库作为项目。仓库 marketplace 文件已纳入检出，不需写入个人 `~/.agents/plugins/marketplace.json` 或手改全局配置。重启桌面端，使仓库 marketplace 刷新。
2. 在插件目录中选 `AgentKanban` 仓库源，检查 `kanban` 的来源是该检出的 `viewer/`，再安装、启用。若目录里没有该源，先核对仓库根、受信项目与 marketplace 路径；不要误用 Kimi 包。
3. **先审核再信任 hooks**：核对 `SessionStart`、`UserPromptSubmit`、`PostToolUse` 命令引用 `PLUGIN_ROOT/server/codex-hook.mjs`，确认实际安装目录下的脚本与内容可信。未信任时 hooks 会被跳过，不能声称服务自动启动或 SYSTEM.md 约定已注入。更新 hook 定义后须重新审核。
4. 新建会话验证 `kanban-open` 与 `kanban-service` 可发现，并在有 `kanban/` 的项目确认四条约定和 SessionStart 校准；另用无 `kanban/` 项目确认不创建项目结构、不执行约定。恢复会话及压缩后也要实测约定。安装后已有会话未必重新加载技能，应开启新会话。
5. 安装源路径为本检出的 `<仓库根>\viewer`；隔离 `CODEX_HOME` 的 CLI 实测安装复制路径为 `<CODEX_HOME>\plugins\cache\agent-kanban\kanban\0.2.4`（本次临时根：`C:\Users\ADMINI~1\AppData\Local\Temp\kanban-cli-31e37e20013a4abc9210be392ddc4c90`）。桌面端的实际复制路径仍须以本机安装界面和文件为准，不能把 CLI 的隔离路径冒充桌面端实测。

## Codex CLI 安装与信任

1. 在此仓库根启动 CLI；用 `/plugins` 打开插件浏览器，切到 `AgentKanban` marketplace，检查并安装/启用 `kanban`。如果仓库源没有出现，可先用 `codex plugin marketplace list` 检查；需要显式注册本地源时，由用户自己在仓库根运行 `codex plugin marketplace add .`，随后再次打开 `/plugins`。该命令会更改用户的 marketplace 配置，仓库发布流程不会代替用户运行。
2. 在 CLI 用 `/hooks` 检查来源、审核信任上述三个事件；未信任或 hooks 被关闭时，不将服务自动启动和约定注入视为生效。先查看实际命令与脚本内容，不使用绕过信任的开关。
3. 重新开启 CLI 会话，再测试新建、恢复、压缩后的上下文和活动恢复。若 `codex` 命令本身不可运行，先修复本地安装/命令关联，再做实测；不要把静态文件校验当作 CLI 安装通过。

## 打开、常驻、取消与停止

- `kanban-open` 技能或 Kimi 原 `/kanban:open` 命令会先确保服务就绪，再打开带 URL 编码项目根的页面；普通打开不取消已选择的常驻模式。`kanban-service` 技能可引导以下控制。
- 脱离 Agent 使用脚本（把 `<插件根>` 换成本机实际安装目录或本仓库 `viewer` 绝对路径；路径含空格/中文时保留引号）：

```powershell
node "<插件根>\server\control.mjs" start --persistent --root "<项目根绝对路径>"
node "<插件根>\server\control.mjs" auto
node "<插件根>\server\control.mjs" status
node "<插件根>\server\control.mjs" stop
```

`start` 不带 `--persistent` 为普通自动启动；`auto`、`status`、`stop` 在未运行时不拉起服务。页面也能查看真实模式、切换并在确认全局影响后停止。模式对所有项目共享；停止只是结束当前进程并保留注册表，**不等于禁用插件**，后续有效活动仍可能以 auto 恢复。常驻是当前进程模式，**不是开机自启、崩溃守护或永久偏好**；正常停止后普通重启回到 auto。服务仅监听本机回环端口 4731（测试可指定 `AGENT_KANBAN_PORT`）。

自动模式在持续超过 180 秒没有有效活动后，于下一次至多约 30 秒的检查退出。会话注册、Codex 用户提交/工具完成、Kimi 心跳、成功的看板业务交互、可见页面约每 60 秒续期算活动；健康/状态查询不续期。闲置聊天、隐藏页面和没有工具完成的长生成**不保证保活**。页面失联时不会自行启动进程，应重新使用本地打开入口；持续可用时显式选择常驻。

## Kimi 迁移、双端共存与回滚

1. 先确认当前服务是否正在被其他项目使用；迁移应由用户安排合适时机，**不要自动停止正在使用的 4731 服务**。旧客户端没有新协议能力时，先显式结束旧服务，再升级 Kimi 到本发布版本并安装 Codex，审核信任 hooks。未升级的旧 Kimi 启动器可能仍按不同版本请求新服务退出，完整共存要求双方均支持新协议。
2. 新版默认共享注册表为 `~/.agent-kanban/registry.json`，可通过 `AGENT_KANBAN_HOME` 覆盖。首次新表缺失时，从 `KIMI_CODE_HOME/kanban-viewer/registry.json` 导入；未设 `KIMI_CODE_HOME` 则从 `~/.kimi-code/kanban-viewer/registry.json` 导入。旧文件只读保留，路径归一化去重并保留较新 `lastSeen`。新表已有数据不由旧表覆盖；导入失败需看 stderr 诊断，不能假定已成功。
3. 新协议服务同版或较新版复用，兼容且本地版本更新时协调升级、继承当前常驻模式；协议不兼容、版本不可比较或端口属于别的程序时不强杀、不自动换代。旧协议可用的普通功能会降级复用，但常驻控制明确不支持。遇到升级冲突 409 可稍后重试。
4. 回滚：用户显式停止新版服务，禁用或移除 Codex 插件后回装旧 Kimi 发行包。不要删除旧注册表或共享注册表。**新版新增注册项目不会自动回写旧 Kimi 表**，回滚后需要时手动重新注册。回滚不自动改写项目 `AGENTS.md`、便签或线程卷宗。

## 验收状态（2026-09-28）

- 自动化：`npm test --prefix viewer`：47 项通过、0 失败（2026-09-28）；`node --test viewer/test/release.test.mjs`：6 项通过、0 失败；`node scripts/release.mjs stage v0.2.4 <临时目录>` 与 `node scripts/release.mjs verify v0.2.4 <临时目录>`：Kimi 28 文件、Codex 27 文件均通过。测试用 `tar.exe -a -c -f` 创建两包并解包复核，覆盖版本错配、隐藏清单或 hook 脚本缺失的负向路径；`openspec validate add-codex-distribution` 通过。测试使用隔离端口、临时数据目录和自身子进程，不连接用户的 4731 或注册表。
- 页面：隔离环境已看到 auto → persistent → auto、跨项目共享同一 mode、升级锁 409 失败提示与释放后重试、确认提示及确认后停止；取消分支通过可注入确认函数测试，确保不发送停止请求。
- Codex CLI 在隔离 `CODEX_HOME` 下的仓库 marketplace 发现和安装已验证（`codex-cli 0.158.0-alpha.2.1`）；Codex 桌面端安装、两端 hooks 未信任/已信任、新建/恢复/压缩会话、中文空格安装路径、冷启动、活动恢复、脚本独立常驻：**仍待真实宿主实测**。隔离 CLI `--no-daemon` 停在登录界面，未绕过认证。PATH 上 WinGet 的 `codex.exe` 命令关联不可运行；改用本机 Codex 应用附带的 CLI，在隔离 `CODEX_HOME` 下执行 `plugin marketplace add .`、`plugin list`、`plugin add kanban@agent-kanban --json`，确认仓库源与实际缓存路径。桌面端、未信任/已信任及会话行为仍待现场实测。
- Kimi 原入口、两个已升级宿主同时共存、运行中覆盖安装、真实换代及显式停止：**待用户在可控环境实测**，不得对用户正在使用的服务直接演练。
- 故障夹具和旧表导入的自动化已覆盖主要分支；旧客户端真实迁移与回滚数据保留：**待用户演练**。未通过项须记录环境、命令、进程数、health 的 `version`/`protocolVersion`/`mode`、注册表前后差异和错误 stderr，不将未测项目标为通过。
