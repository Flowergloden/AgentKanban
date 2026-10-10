# Tasks

## 1. Claude 宿主清单与 hooks

- [x] 1.1 新增 `viewer/.claude-plugin/plugin.json`（name `kanban`、version 与 service.json 一致、`hooks: "./hooks/claude-hooks.json"`，skills 走默认扫描），用 `claude plugin validate viewer` 或等价方式确认清单可解析
- [x] 1.2 新增 `viewer/hooks/claude-hooks.json`：SessionStart（无 matcher）调用 `codex-hook.mjs start`，UserPromptSubmit / PostToolUse 以 `async` 调用 `codex-hook.mjs activity`，均用 `command: "node"` + `args` 与 `${CLAUDE_PLUGIN_ROOT}`；在 `viewer/test/hooks.test.mjs` 增加测试：解析该文件、校验三事件与脚本引用，并以 Claude 形态 stdin（含 `clear`/`compact`/`fork` 来源）驱动 start 分支，断言输出完整约定、非 startup/resume 来源不调用 ensure，`npm test --prefix viewer` 通过
- [x] 1.3 在 `viewer/test/hooks.test.mjs` 增加 activity 分支用例：Claude PostToolUse 的 `tool_input.command` 含 `control.mjs status` 时被识别为控制事件而跳过；测试通过
- [x] 1.4 宿主中立文案：`viewer/server/ensure.mjs` 迁移提示改为不点名宿主，`viewer/skills/kanban-service/SKILL.md` 去掉"勿使用 Kimi 安装路径"的宿主点名；`grep -n "Kimi 和 Codex\|Kimi 安装路径" viewer/server viewer/skills` 无结果且既有测试通过

## 2. 三宿主发布流水线

- [x] 2.1 `scripts/release.mjs`：新增 `filesFor('claude')`（共享资源 + `.claude-plugin/plugin.json` + `hooks/claude-hooks.json` + `server/codex-hook.mjs`）；`stageRelease` 校验 tag、三份 manifest、service.json 版本一致并暂存三宿主；CLI `verify` 遍历三宿主；本地 `node scripts/release.mjs stage vX.Y.Z <tmp>` 与 `verify` 输出三行 JSON
- [x] 2.2 `verifyPackage` 增加 Claude 分支：manifest 引用以 `./` 开头且在包内，hooks 三事件齐全、脚本在白名单且只使用 `${CLAUDE_PLUGIN_ROOT}`，包内不存在 `hooks/hooks.json` 与 `commands/`；所有宿主共用 SYSTEM.md ≤ 10,000 字符断言
- [x] 2.3 扩展 `viewer/test/release.test.mjs`：三包解包后文件树精确、Claude manifest 版本不一致时 stage 失败、缺 Claude 清单 / hooks 引用脚本 / 混入 `hooks/hooks.json` 时 verify 失败、SYSTEM.md 超 10,000 字符时失败；`node --test viewer/test/release.test.mjs` 通过
- [x] 2.4 `.github/workflows/release.yml`：增加 Claude 包 zip、解包校验与 `kanban-claude-plugin.zip` 上传，步骤名改为三宿主；用 `node scripts/release.mjs` 本地复现同等暂存/解包/verify 流程确认通过
- [x] 2.5 新增仓库根 `.claude-plugin/marketplace.json`（name `agent-kanban`，kanban 条目为 archive 源指向 `releases/latest/download/kanban-claude-plugin.zip`，不写条目 version）；在 release 测试中断言其 JSON 合法、URL 为 https 且文件名与流水线产物一致

## 3. 文档

- [x] 3.1 新增 `docs/claude-distribution.md`：前置条件（Node.js、Claude Code ≥ v2.1.224）、`/plugin marketplace add` 与 `/plugin install kanban@agent-kanban`、新会话验证（有/无 `kanban/` 项目）、手动更新命令与可选自动更新、latest 未 pin 摘要的信任边界、常驻控制脚本、卸载与回滚、与 Kimi/Codex 共存说明；按文档逐条核对命令名与仓库实际文件一致
- [x] 3.2 在 `docs/manual-acceptance.md` 追加 Claude Code 验收清单（新建/恢复/clear/compact/fork 注入、冷启动与活动恢复、stop 不被自身事件抵消、无 `kanban/` 项目不建结构、中文空格路径、与运行中 Kimi/Codex 服务复用、更新到新版本）；清单项均标注"待实测"

## 4. 集成验证

- [x] 4.1 暂存 Claude 包后用 `claude --plugin-dir <stage>/claude` 开新会话冒烟：上下文含约定、服务健康检查可达且注册当前项目、工具调用后活动续期；记录结果到 manual-acceptance
- [x] 4.2 运行 `npm test --prefix viewer` 与 `openspec validate add-claude-distribution` 全部通过

## Workflow follow-up

- 合入后同步升级 tag、三份 manifest 与 service.json 版本并打 tag，确认 Release 含三个附件。
- 发布后在本机 Claude Code 通过 marketplace 安装并按 manual-acceptance 实测，记录检查更新是否需完整下载 archive。
- 归档 change 后按约定三向线程卷宗追加蒸馏总结（若本 change 登记在某线程 `## Changes`）。
