# 双宿主现场验收记录（待用户填写）

此表只记录实际操作。先确认 4731 服务是否正被使用；涉及停止、升级或回滚时安排可控时段。每项填日期、宿主版本、结果及证据；未执行维持「未测」，不等同通过。

## 准备

- Windows、Node.js：`node --version` → ______
- 仓库检出：______；Kimi 插件版本：______；Codex 桌面端版本：______；Codex CLI 版本：______
- 隔离/真实服务端口与共享数据目录：______（测试尽量使用 `AGENT_KANBAN_PORT`、`AGENT_KANBAN_HOME`；切勿对正在使用的 4731 执行停止测试）
- marketplace 源：`<仓库根>/.agents/plugins/marketplace.json` → `./viewer`；实际安装复制目录：______
- 每次保留 `GET /api/health` 的 `pid`、`version`、`protocolVersion`、`mode`、注册表摘要及 stderr。

## Codex 桌面端和 CLI（对应 6.1、7.2）

| 宿主 | 场景 | 结果 | 日期/证据/备注 |
| --- | --- | --- | --- |
| 桌面端 | 仓库源发现 kanban；安装目录记录，未信任 hooks 时不自动启动/注入 | 未测 | |
| 桌面端 | 审核并信任三个 hooks；新建、恢复、压缩后四条约定与 kanban 守卫 | 未测 | |
| 桌面端 | 中文/空格路径、冷启动、活动恢复、脚本常驻/取消/停止 | 未测 | |
| CLI | 隔离 `CODEX_HOME` 的 `plugin marketplace add .`、`plugin list`、`plugin add kanban@agent-kanban --json` | 通过 | 2026-09-28；安装至临时 `<CODEX_HOME>/plugins/cache/agent-kanban/kanban/0.2.4`，清单/hooks/脚本/技能完整；未触碰个人配置。 |
| CLI | 交互 `/plugins`、`/hooks` 未信任/已信任与新会话 | 未通过环境门槛 | 2026-09-28：应用附带 CLI 普通 TUI 报「no complete local package」；`--no-daemon` 进入登录界面，隔离 `CODEX_HOME` 未授权登录，未进入会话或执行 hooks。 |
| CLI | 新建、恢复、压缩后约定；中文/空格路径、冷启动及活动恢复 | 未测 | |
| 页面 | auto/常驻、409 重试、停止确认、跨项目模式 | 通过（组合验收） | 2026-09-28 隔离端口：项目 B 常驻后项目 A 显示同一 mode；锁占用时 409 保持原 mode，释放后重试成功；确认提示出现且停止释放端口。取消分支由 `service-controls.test.mjs` 注入 `confirm=false` 验证未发送请求。 |

页面交互与纯控制逻辑组合验收已完成。浏览器自动化对原生 confirm 的取消按钮不可控，因此取消分支使用可注入确认函数的测试验证；未声称浏览器手工按过取消。

## Kimi 与双宿主共存（对应 7.3）

| 场景 | 结果 | 进程数/health/注册表/备注 |
| --- | --- | --- |
| `/kanban:open` 原入口及 Kimi 心跳恢复 | 部分 | 发行包 Kimi `ensure.mjs`/`heartbeat.mjs` 与 Codex 适配器在隔离端口复用同一 PID；本机无 `~/.kimi-code/plugins/managed/kanban`，无法在 Kimi 宿主中实测命令派发。 |
| 升级后 Kimi 与 Codex 桌面端、CLI 共用单进程 | 未测 | |
| 同协议不同版本复用较新服务，不反复替换 | 未测 | |
| 运行中覆盖安装，服务 cwd 在插件目录外 | 未测 | |
| persistent 换代继承并保留注册表，显式停止释放端口 | 未测 | |

## 迁移、故障与回滚（对应 7.4）

| 场景 | 结果 | 旧/新注册表摘要、stderr/限制 |
| --- | --- | --- |
| 旧 Kimi 注册表首次非破坏性导入；已有新表不覆盖 | 隔离通过 | `registry.test.mjs` 与 `dual-host.test.mjs`：规范化、去重、较新 lastSeen、新表优先、旧表原文保留。实际旧用户目录迁移未测。 |
| 旧协议无退出能力时降级复用、常驻拒绝 | 故障夹具通过 | `protocol.test.mjs`：旧接口可用时注册复用，常驻拒绝，shutdown 未调用。实际旧 Kimi 进程未测。 |
| 非看板服务端口冲突不误杀；启动/换代失败报告 | 故障夹具通过 | `coordination.test.mjs`、`upgrade.test.mjs`、`control.test.mjs`：异类端口未收 shutdown、换代失败有诊断、损坏旧表原文保留。 |
| 停止新版、禁用 Codex、回装旧 Kimi；两个注册表均保留 | 部分 | 隔离双包脚本测试确认停止/普通重启后旧表原文和共享表保留；无真实旧 Kimi 安装可执行回装。 |

已知边界：旧 Kimi 客户端若未升级，仍可能向新版服务发送旧式退出请求；新版新增注册项目不会自动写回旧表。常驻不是开机自启，显式停止不是禁用 hooks。失败项须写明可复现步骤，不得改成「通过」。

现场未通过环境门槛不是功能通过：Codex 桌面端插件界面未安装验收；隔离 CLI 缺认证；Kimi 实机缺托管安装。剩余 7.2–7.4 不勾选，待具备宿主环境后补证据。
