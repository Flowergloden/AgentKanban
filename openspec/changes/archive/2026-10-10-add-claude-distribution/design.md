# Design

## Context

动机见 proposal.md。现状：viewer 是 Kimi / Codex 共享源码根，宿主差异只在 manifest、hooks 与少数入口脚本；`scripts/release.mjs` 用 `filesFor(host)` 白名单按宿主暂存与校验，版本以 `service.json` 为准并与各 manifest 比对；`server/codex-hook.mjs` 读取 stdin 的 `cwd`/`source`，start 分支在 startup/resume 时 `ensure`、无条件输出 SYSTEM.md 作为 `additionalContext`，activity 分支调用节流的 `reportActivity`。skills 以自身目录相对定位脚本，不含宿主路径。

2026-10-10 读取的 Claude Code 官方文档（plugins-reference、marketplace-reference、host-marketplace、loading、hooks）给出的约束：

- 清单为 `.claude-plugin/plugin.json`；插件根的 `hooks/hooks.json` 若存在**总会被合并加载**，manifest 的 `hooks` 字段只能追加不能屏蔽；`commands/` 会被默认扫描。
- hook 中仅替换 `${CLAUDE_PLUGIN_ROOT}` 等 `CLAUDE_*` 变量；支持 `command`+`args` 免 shell 形式与 `async`；Windows 默认经 Git Bash 执行 shell 形式。
- SessionStart 来源为 `startup`/`resume`/`clear`/`compact`/`fork`；`additionalContext` 上限 10,000 字符；插件无 systemPrompt 能力，插件根 CLAUDE.md 不加载。
- marketplace plugin source 支持 `archive`（HTTPS zip，可选 sha256，需 Claude Code ≥ v2.1.224，≤ 256 MiB、≤ 5 次 HTTPS 重定向）；版本先取 manifest `version`；每个版本单独缓存到 `cache/<marketplace>/<plugin>/<version>/`，旧目录标记孤儿 14 天后清理；自动更新默认关闭。

## Goals / Non-Goals

**Goals:**
- Claude 宿主层只新增清单、hooks 配置与发布白名单，业务脚本零新增。
- Kimi、Codex 的源码布局、已信任 hooks 与附件名不变，不触发 Codex 用户重新信任。
- 发布流水线在上传前拦截 Claude 包的版本、文件与约定长度缺陷。

**Non-Goals:**
- 本地相对路径 marketplace 源（与 Codex `hooks/hooks.json` 冲突，见 D1）。
- 官方插件目录上架、按版本 pin sha256 的 marketplace 自动改写、Linux/macOS 认证。
- 为 Claude 新增 commands（打开入口由 `kanban-open` skill 承担）。

## Decisions

### D1：archive 源 + Release 附件，而非相对路径源

仓库根新增 `.claude-plugin/marketplace.json`（marketplace 名 `agent-kanban`），kanban 条目 `source: {source: "archive", url: ".../releases/latest/download/kanban-claude-plugin.zip"}`，不写条目 `version`，以 manifest 为准。

备选：相对路径 `./viewer`。Claude 会强制合并 viewer 下 Codex 的 `hooks/hooks.json`（`${PLUGIN_ROOT}` 不被替换，每次会话报错）并扫描 Kimi 的 `commands/`；要避开只能改动 Codex/Kimi 已验收布局。archive 源沿用已有的"白名单包"模型，三包天然隔离。代价是本地开发须用暂存目录 `claude --plugin-dir` 验证，且 latest URL 不能 pin sha256。

### D2：Claude hooks 源文件独立命名，包内不放 hooks/hooks.json

源文件放 `viewer/hooks/claude-hooks.json`，Claude manifest `"hooks": "./hooks/claude-hooks.json"`；Claude 白名单不含 `hooks/hooks.json`，因此包内不会合并 Codex 配置。`filesFor` 维持源路径与包路径一一对应，无需引入路径映射。

备选：源文件放 `viewer/claude/hooks.json`，暂存时改名为包内 `hooks/hooks.json`。需要给 stage/verify 加映射层，收益只是包内用默认文件名，放弃。

`verifyPackage` 对 Claude 包追加断言：存在 `.claude-plugin/plugin.json`，manifest 引用均以 `./` 开头且在包内，hooks 命令引用的脚本在白名单内且只使用 `${CLAUDE_PLUGIN_ROOT}`，不存在 `hooks/hooks.json` 与 `commands/`，`SessionStart`/`UserPromptSubmit`/`PostToolUse` 三事件均已声明。

### D3：hook 配置直接复用 codex-hook.mjs

```
SessionStart      (无 matcher，覆盖全部来源)
  command: node  args: ["${CLAUDE_PLUGIN_ROOT}/server/codex-hook.mjs", "start"]   timeout 15
UserPromptSubmit / PostToolUse
  command: node  args: ["${CLAUDE_PLUGIN_ROOT}/server/codex-hook.mjs", "activity"] timeout 12, async
```

Claude 的 stdin（`cwd`、`source`、`hook_event_name`、`tool_input`）与输出格式（`hookSpecificOutput.additionalContext`）与 Codex 一致，现有分支逻辑恰好满足 spec：startup/resume 才 `ensure`，所有来源都注入正文；`isDiagnosticOrControl` 对 Bash/PowerShell 工具的 `tool_input.command` 文本同样生效。

备选：把脚本改名为宿主中立的 `hook.mjs`。会改动 Codex hooks.json 触发重新信任，收益仅是命名美观，放弃；文件名中的 codex 字样在 design 中注明为历史命名。若实现时发现 Claude 特有字段差异，只允许在该脚本内加最小分支，不复制脚本。

`args` 形式不经 shell，规避 Git Bash / PowerShell 对含空格、中文插件路径的引号差异。

### D4：三宿主发布校验

`filesFor('claude') = shared + ['.claude-plugin/plugin.json', 'hooks/claude-hooks.json', 'server/codex-hook.mjs']`。`stageRelease` 读取三份 manifest 校验版本与 tag、service.json 一致；新增 SYSTEM.md 字符数 ≤ 10,000 的断言（按 JS 字符串长度计，留给 Claude 侧统计口径的差异由正文现有约 4,000 字符的余量吸收）。release.yml 多一次 zip / 解包 / verify 与上传附件 `kanban-claude-plugin.zip`。

### D5：宿主中立的诊断文案

`ensure.mjs` 中"请升级 Kimi 和 Codex 插件"改为"请升级所有宿主的 kanban 插件"；kanban-service skill 中"勿使用 Kimi 安装路径"改为不点名宿主。其余共享代码不点名宿主。

## Risks / Trade-offs

- [首发时 latest 附件不存在，marketplace 安装失败] → 合入后立即打 tag 发布；文档注明安装前提为已有含 Claude 附件的 Release。
- [latest URL 未 pin sha256] → 文档声明信任边界为本仓库 GitHub Release；需要强校验的用户可自建 marketplace 条目 pin 某版本 URL 与摘要。
- [检查更新是否需完整下载 zip 未经核实] → 包体远小于限制，影响可忽略；实测时记录行为。
- [Claude 按版本目录缓存，旧版目录保留 14 天] → 服务 cwd 已外置于 tmpdir，不锁目录；运行中旧代码由现有换代协议在新版 ensure 时替换。
- [PostToolUse 在 Claude 中触发频繁] → 已有 45 秒节流与 async 执行；控制/诊断事件排除沿用。
- [SYSTEM.md 未来增长超过 10,000 字符] → 发布校验硬性拦截。

## Migration Plan

1. 实现清单、hooks、白名单与校验，本地 `node scripts/release.mjs stage/verify` 与 `npm test --prefix viewer` 通过；用暂存目录 `claude --plugin-dir <stage>/claude` 做会话级冒烟（注入、ensure、活动续期）。
2. 合入后升版本号（tag 与三份 manifest、service.json 一致）并打 tag，流水线产出三个附件。
3. 在本机 Claude Code 中 `/plugin marketplace add <owner>/AgentKanban`、`/plugin install kanban@agent-kanban`，按 docs 验收清单实测；与已运行的 Kimi/Codex 服务共存验证复用。
4. 回滚：`/plugin uninstall kanban@agent-kanban` 并移除 marketplace；共享注册表与服务不受影响，Kimi/Codex 附件与安装不变。

## Open Questions

- Claude Code 检查更新时是否需完整下载 archive 才能读到 manifest 版本：实测记录即可，不影响方案。
