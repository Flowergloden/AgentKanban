# Proposal

## Why

AgentKanban 目前只分发 Kimi 与 Codex 两个宿主版本，Claude Code 用户只能手动把 SYSTEM.md 与线程卷宗喂给会话，无法获得约定注入、服务自动拉起与打开入口。Claude Code 插件体系已提供 SessionStart additionalContext、活动类 hooks 与 marketplace `archive` 源（HTTPS zip），可以复用现有共享业务核心与 Codex 的 hook 适配，以很薄的宿主层补齐第三个宿主。

## What Changes

- 新增 Claude Code 插件清单 `viewer/.claude-plugin/plugin.json` 与 Claude 专用 hooks 文件 `viewer/hooks/claude-hooks.json`；Claude 包内 hooks 使用 `${CLAUDE_PLUGIN_ROOT}` 与免 shell 的 `command`+`args` 形式，复用现有 `server/codex-hook.mjs` 的 start/activity 入口，不新增业务脚本。
- SessionStart 覆盖 `startup`/`resume`/`clear`/`compact`/`fork` 注入共享约定正文；仅 `startup`/`resume` 确保服务；UserPromptSubmit 与 PostToolUse 以异步 hook 作为活动信号，沿用现有节流与控制/诊断事件排除。
- 发布流水线扩展为三宿主白名单打包：新增 `kanban-claude-plugin.zip`，版本一致性校验扩展到 tag、三份 manifest 与 service.json；新增约定正文不超过 Claude additionalContext 10,000 字符上限的校验；Claude 包 MUST NOT 携带 Codex hooks 或 Kimi commands。
- 新增仓库根 `.claude-plugin/marketplace.json`，以 `archive` 源指向 Release 的 latest `kanban-claude-plugin.zip`；用户通过 `/plugin marketplace add` + `/plugin install kanban@agent-kanban` 安装，更新以 manifest `version` 变化为准。
- Kimi 与 Codex 的源码布局、清单、hooks 与已发布附件名保持不变；宿主点名的提示文案改为宿主中立。
- 新增 Claude Code 安装、更新、版本门槛（≥ v2.1.224）与验收说明。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `plugin-distribution`: 由双宿主扩展为 Kimi / Codex / Claude Code 三宿主分发，新增 Claude archive marketplace 安装源、三包白名单与四源版本一致性、约定正文长度校验及 Claude 安装更新说明。
- `kanban-viewer`: 服务自动拉起、活动续期、打开入口与约定注入的宿主范围加入 Claude Code，明确 Claude 的 SessionStart 来源覆盖与活动 hook。
- `kanban-threads`: 常驻约定承载方式加入 Claude Code 的 SessionStart additionalContext。

## Impact

- 代码：新增 `viewer/.claude-plugin/plugin.json`、Claude hooks 源文件；`scripts/release.mjs` 增加 claude 宿主；`viewer/server/ensure.mjs` 提示文案；相关测试（release、hooks）。`server/codex-hook.mjs`、skills、web、服务协议不改或仅微调。
- 发布：`.github/workflows/release.yml` 多产出一个附件；仓库根新增 `.claude-plugin/marketplace.json`。合入后须先发布一次 Release，marketplace 才能安装。
- 文档：新增 Claude Code 安装与验收说明。
- 依赖与边界：无新运行时依赖；要求 Claude Code ≥ v2.1.224 与可执行的 Node.js。latest URL 不固定 sha256，信任 GitHub Release 附件本身。首版仅以 Windows 本地 Claude Code CLI 为验收目标；官方插件目录上架、本地相对路径 marketplace 源、Linux/macOS 认证不在本次范围。
