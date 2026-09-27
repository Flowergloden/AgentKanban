# Proposal

## Why

kanban 工作流目前无法离开本仓库：四条 Agent 约定写在项目 `AGENTS.md` 里，插件以 `local-path` 方式安装（托管副本是安装时的快照，之后源码改动不会生效），新项目或其他机器要使用这套工作流只能手工复制文件。kimi-code 插件机制（`systemPromptPath` 全局注入、GitHub Release 附件 zip 安装）已经提供了完整通道，缺的是把约定层搬进插件、并建立发布流水线。

## What Changes

- 插件新增 `viewer/SYSTEM.md`：四条常驻约定（会话校准、拐点捕获、归档蒸馏、便签人类专属）改写为全局条件式措辞——项目根存在 `kanban/` 时适用，否则不动作；经 manifest 的 `systemPromptPath` 注入所有项目会话。
- `viewer/kimi.plugin.json`：新增 `systemPromptPath` 字段；`version` 升至 0.2.0；`description` 从"看板可视化"改为 kanban 工作流载体的定位。
- 删除仓库根 `AGENTS.md`：其全部内容即四条约定，迁入插件后整体移除，不留指针或镜像文本。
- `kanban/README.md`：「Agent 侧约定（摘要）」一节改为指向插件 `SYSTEM.md`。
- **BREAKING**（行为变化）：`viewer/server/ensure.mjs` 不再对会话所在项目自动调用初始化接口；`kanban/` 结构改为惰性补齐——仅在写操作（创建线程、设活跃等）或看板页面加载项目时自动创建。避免插件全局常驻后污染无关项目。
- 新增 `.github/workflows/release.yml`：`v*` tag 触发，校验 tag 与 manifest `version` 一致，将 `viewer/` 内容打包为 `kanban-plugin.zip`（`kimi.plugin.json` 位于 zip 根）并上传到 GitHub Release。
- 安装与更新路径从 `local-path` 切换为恒定 URL：`https://github.com/Flowergloden/AgentKanban/releases/latest/download/kanban-plugin.zip`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `kanban-threads`：归档蒸馏需求的提示载体由「`openspec/config.yaml` guidance 与项目 `AGENTS.md`」改为「kanban 插件 systemPrompt 常驻约定」；新增约定载体的整体需求（四条约定由插件承载、全局条件式措辞、项目 AGENTS.md 不再作为载体）。
- `kanban-viewer`：插件职责从「看板可视化」扩展为「kanban 工作流载体」（systemPrompt 注入约定）；初始化需求中删除「SessionStart hook 自动初始化会话所在项目」，改为惰性补齐。

## Impact

- **代码**：`viewer/SYSTEM.md`（新建）、`viewer/kimi.plugin.json`、`viewer/server/ensure.mjs`、`.github/workflows/release.yml`（新建）、`AGENTS.md`（删除）、`kanban/README.md`。
- **Spec**：`kanban-threads`、`kanban-viewer` 两个 capability 的需求修订。
- **安装形态**：插件从本地开发快照变为 release 附件分发；zip-url 安装的更新检测行为官方文档未明确，实施时需实测并在发布说明中写明更新路径。
- **本仓库自身**：`AGENTS.md` 删除后，本仓库的 kanban 约定依赖插件 systemPrompt 生效；`openspec/config.yaml` 的归档 guidance 保留，降级为可选增强。
