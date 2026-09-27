# Design

## Context

当前形态见 proposal.md 的 Why。与本设计直接相关的现状：

- 插件 `viewer/` 已通过 manifest hooks 提供 SessionStart/SessionHeartbeat 能力，其中 `viewer/server/ensure.mjs` 在服务就绪后会对会话 `cwd` 依次调用 `/api/register` 与 `/api/init`（自动初始化项目结构）。
- 四条 Agent 约定当前只存在于仓库根 `AGENTS.md`；`openspec/config.yaml` 的 `operations.archive.guidance` 单独提示归档蒸馏。
- kimi-code 插件机制提供两个关键通道：manifest `systemPromptPath`（向所有项目会话注入指令，单文件上限 32KB，约定文本约 2KB）与 `/plugins install <zip-url>`（从 URL 安装 zip，`kimi.plugin.json` 须位于 zip 根）。
- 本仓库托管于 GitHub（`Flowergloden/AgentKanban`），可用 Releases 附件作为 zip 分发物。

## Goals / Non-Goals

**Goals:**

- 装一次插件（一条 install 命令），任意项目即获得完整 kanban 工作流：约定生效 + 看板服务可用 + `kanban/` 惰性就绪。
- 约定文本单一事实来源（插件内 `SYSTEM.md`），更新随插件版本分发。
- 发布流程一键化：打 tag 即出 release 附件。

**Non-Goals:**

- 不改看板服务/前端的任何功能行为（初始化接口本身保留，仅取消 SessionStart 的自动调用）。
- 不做插件自动更新；更新由用户在插件管理器触发。
- 不处理 `.kimi-code/skills/openspec-*` 的分发（属于 OpenSpec 自身安装产物）。
- 不为团队/多用户场景设计权限或私有分发。

## Decisions

### D1：约定层经 `systemPromptPath` 随插件分发

新建 `viewer/SYSTEM.md` 承载四条约定，manifest 加 `"systemPromptPath": "./SYSTEM.md"`。约定文本改写为全局条件式：开头先判定"项目根存在 `kanban/` 目录"，不满足则全部约定不适用、禁止任何看板动作（含禁止主动创建 `kanban/`）。

- 替代方案 A（落盘项目 AGENTS.md，提供 `/kanban:init` 写托管块）：约定随 git 仓库走，但每个项目要跑一次 init，且更新需要合并语义；对本工作流的单人使用场景属于过度设计。
- 替代方案 B（`sessionStart.skill` 注入）：与 systemPrompt 等价但更间接（skill 加载语义），systemPromptPath 语义更直接。
- 已知代价：约定对所有项目常驻（约 2KB 提示词开销）；未装插件的环境（其他 agent 工具）看不到约定。均接受。

### D2：`kanban/` 结构改为惰性补齐

`ensure.mjs` 删除对 `/api/init` 的调用（保留服务拉起与 `/api/register` 注册）。结构创建时机收敛为两处已有路径：看板页面加载项目、任意写操作（创建线程/设活跃等，服务端自动补齐）。

- 理由：插件全局常驻后，SessionStart 自动初始化会在每个被打开的项目里创建 `kanban/`，污染无关仓库；而空 `current` 下约定一恒为无操作，自动初始化买不到任何体验。
- 页面加载仍保留自动初始化：用户主动打开某项目看板是明确的意图信号。

### D3：GitHub Release 附件 zip + tag 触发的 Action

`.github/workflows/release.yml`：`v*` tag 触发 → 校验 tag 版本与 `viewer/kimi.plugin.json` 的 `version` 一致（不一致则失败）→ 在 `viewer/` 目录内打 zip（保证 `kimi.plugin.json` 位于 zip 根）→ `gh release create` 上传 `kanban-plugin.zip`。

- 替代方案（整仓库即插件，manifest 移到仓库根）：安装更短（仓库 URL 即可），但分发物混入 kanban/、openspec/ 等开发文件，且仓库根被插件清单占据；拒绝。
- 发布动作：手动递增 manifest `version` → 提交 → 打同号 tag 推送。校验步骤保证两边不会错版。
- 安装 URL 恒定为 `releases/latest/download/kanban-plugin.zip`，文档与技能文件只需写一次。

### D4：本仓库 AGENTS.md 整体移除

仓库根 `AGENTS.md` 的全部内容即四条约定，迁移后删除该文件，不留指针。`kanban/README.md` 的「Agent 侧约定（摘要）」一节改为指向插件 `SYSTEM.md`。`openspec/config.yaml` 的归档 guidance 保留（降级为可选增强，与 spec delta 措辞一致）。

## Risks / Trade-offs

- [zip-url 安装的更新检测行为官方文档未明确（管理器是否提示"可更新"未知）] → 实施验收时实测；若不提示，发布说明中写明"重新执行同一 install 命令即更新"，该 URL 恒定所以重装体验可接受。
- [`SYSTEM.md` 改写引入措辞漂移（与 AGENTS.md 原文语义不一致）] → 改写时逐条对照现行四条约定，仅加守卫与主语调整，不改变触发条件与防抖约束；完成后在本仓库会话中实测校准/拐点行为。
- [删除 AGENTS.md 后本仓库在无插件环境失去约定] → 可接受：本仓库使用场景以装了插件的 kimi-code 为前提（线程决策已记录）。
- [tag 与 manifest 版本错位发出错版包] → Action 内置一致性校验，错则发布失败。
- [已有用户（当前即作者本人）以 local-path 安装，残留旧托管副本] → 迁移步骤：先 `/plugins remove kanban` 再以新 URL 安装；remove 只删记录不删文件，无数据风险。

## Migration Plan

1. 完成代码改动（SYSTEM.md、manifest、ensure.mjs、README、workflow），合并到主分支。
2. 本机切换安装源：`/plugins remove kanban` → `/plugins install https://github.com/Flowergloden/AgentKanban/releases/latest/download/kanban-plugin.zip`（首个 release 发布后再执行）。
3. manifest `version` 升至 `0.2.0`，打 `v0.2.0` tag 推送，验证 Action 产出附件。
4. 新开会话验证：约定注入生效（本仓库校准行为正常）、无关项目不被创建 `kanban/`、看板页面与写操作惰性补齐正常。
5. 回滚：重新以 local-path 安装 `viewer/` 目录即可回到开发态；`AGENTS.md` 可从 git 历史恢复。

## Open Questions

- zip-url 安装在插件管理器中的更新提示行为（见 Risks 第一条），实测后写入发布说明，不影响 spec 与任务拆分。
