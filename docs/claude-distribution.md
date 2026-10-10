# AgentKanban 在 Claude Code 中的安装、更新与验收（Windows 本地）

本文适用于仓库根 `.claude-plugin/marketplace.json` 中的 `kanban` 插件，它以 Release 附件 `kanban-claude-plugin.zip` 的 archive 源安装。首版仅以 Windows 本地 Claude Code CLI 为验收目标；官方插件目录上架、Linux/macOS 认证不在范围内。

## 前置条件

1. Claude Code **≥ v2.1.224**。低于该版本时 archive 源不可用，先升级 Claude Code。
2. 可在终端执行的 Node.js，`node --version` 可以正常输出版本号。共享服务由 Node.js 后台启动。
3. 已有包含 `kanban-claude-plugin.zip` 附件的 Release。合入后须先打 tag 发布一次，marketplace 才能安装。

## 安装

在 Claude Code 中依次执行：

```
/plugin marketplace add Flowergloden/AgentKanban
/plugin install kanban@agent-kanban
```

安装完成后开启新会话。插件的 hooks 首次出现时需要按 Claude Code 的提示审核并信任；未信任时，服务自动启动与约定注入不生效，不能视为已安装成功。

## 新会话验证

- **有 `kanban/` 的项目**：新会话开始时应注入 SYSTEM.md 中的四条约定；`kanban-open` 与 `kanban-service` 两个技能可被发现；运行 `kanban-open` 后浏览器打开当前项目的看板。
- **没有 `kanban/` 的项目**：约定只在看板项目中生效，Agent 不应创建 `kanban/` 结构，也不执行看板动作。

`clear`、`compact`、`fork` 来源的会话同样会注入约定，但不会额外拉起服务；`startup` 与 `resume` 才会确保服务运行。

## 更新

- **手动更新**：发布新版本后，执行 `/plugin marketplace update agent-kanban`，再执行 `/plugin update kanban@agent-kanban`，然后开启新会话。（以上命令名以本机 Claude Code 的 `/plugin` 菜单为准，实测结果记录在 `docs/manual-acceptance.md`。）
- **自动更新（可选）**：在 `/plugin` 菜单中为 `agent-kanban` 市场开启自动更新。Claude Code 默认关闭自动更新。
- 更新以插件 manifest 的 `version` 变化为准。新版本安装到独立的版本目录，旧目录不会阻塞安装。运行中的服务会按协议换代规则在下一次有效启动时升级。

## 信任边界

marketplace 的 kanban 条目指向 `releases/latest/download/kanban-claude-plugin.zip`，**未固定 sha256 摘要**。信任的根是本仓库的 GitHub Release 附件本身。需要强校验的用户，应自建 marketplace 条目，固定到某个版本的 URL 与摘要。

## 常驻控制脚本

插件提供统一控制脚本 `server/control.mjs`，安装目录即插件根目录（Claude Code 缓存目录，路径以本机 `/plugin` 显示为准）：

```
node "<插件根>/server/control.mjs" status
node "<插件根>/server/control.mjs" start --persistent --root "<项目根>"
node "<插件根>/server/control.mjs" auto
node "<插件根>/server/control.mjs" stop
```

- `start [--persistent] [--root <path>]`：启动服务；`--persistent` 表示常驻，不因空闲退出。
- `auto`：恢复默认的空闲退出模式。
- `status`：查看运行状态与模式。
- `stop`：停止服务。

常驻不等于开机自启；停止服务也不等于禁用插件。路径含空格或中文时须保留引号。

## 卸载与回滚

```
/plugin uninstall kanban@agent-kanban
/plugin marketplace remove agent-kanban
```

卸载插件不删除用户数据。共享注册表与服务不受影响；如需回滚到旧版本，可卸载后重新安装指定版本的插件。Kimi 与 Codex 的安装和附件保持不变。

## 与 Kimi / Codex 共存

- 三个宿主共用同一本地服务（127.0.0.1，默认端口 4731）和同一共享注册表。
- 任一宿主启动的服务，其余宿主的有效启动或活动事件会直接复用，不会重复启动第二个进程。
- 协议不兼容的旧客户端可能仍会向新版服务发送旧式退出请求；完整共存要求各端升级到支持新协议的版本。
- 本插件不修改用户全局配置，也不修改项目的 AGENTS.md 或 CLAUDE.md。
