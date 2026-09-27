# 插件分发

status: 规划

<!-- 状态可选值：立项、规划、实现、完成。流转方式：直接修改上一行的 status 值。 -->

## 目标

规划 kanban 工作流的分发方式，包括安装、初始化、更新等

## 已完成的工作

<!-- 每完成一段工作，在此追加一条记录（含日期与概要），小需求一句话即可，无需关联 change。若使用 OpenSpec：属于本线程的 change 归档后，其蒸馏总结也追加在这里。 -->

- 2026-09-27：完成分发方式规划。盘点出工作流的三层组成（L1 约定层 / L2 数据层 / L3 工具层），确认 L2 已被插件初始化接口覆盖；确定目标架构：插件经 `systemPromptPath` 承载四条约定，经 GitHub Release 附件 zip + GitHub Action 自动发布。后续待办：改写 SYSTEM.md（全局条件式措辞）、移除本仓库 AGENTS.md 的 kanban 约定、编写发布 Action、修订 kanban-threads 与 kanban-viewer spec、验证 zip-url 安装的更新检测行为。
- 2026-09-27：方案定稿。SYSTEM.md 守卫措辞、GitHub Action 步骤（版本一致性校验、zip 打包、gh release 上传）、两个 spec 的修订点均已明确；新增决策见 ## 决策（惰性初始化）。创建 OpenSpec change `add-plugin-distribution` 进入实施准备。

## 决策

<!-- 每条决策 MUST 同时包含"决定了什么"与"为什么"，格式：
- **决定**：……
  **原因**：……
-->

- **决定**：四条 Agent 约定（L1 约定层）随插件分发：改写为全局条件式措辞（项目根存在 `kanban/` 时适用，否则不动作）后放入插件 `SYSTEM.md`，经 manifest 的 `systemPromptPath` 注入所有项目的会话；不再以项目内 AGENTS.md 为载体。
  **原因**：装一次插件即全项目生效，与 L2 的 `kanban/` 自动初始化拼合后新项目零配置；约定更新随插件更新自然到达；约定本身含空值守恒降级，对不使用看板的项目无害。
- **决定**：插件以 GitHub Release 附件 `kanban-plugin.zip`（zip 根含 `kimi.plugin.json`，仅含 viewer/ 内容）分发，并用 GitHub Action 在打 tag 时自动打包上传。
  **原因**：分发物干净、与开发仓库解耦；`releases/latest/download/...` URL 恒定，安装与更新路径简单；自动化发布避免手工打包出错。
- **决定**：约定迁入插件后，本仓库 AGENTS.md 中的 kanban 约定整体移除，不保留指针或镜像文本。
  **原因**：保持单一事实来源（插件 SYSTEM.md），避免两处文本漂移；本仓库的使用场景均以装了插件的 kimi-code 为前提。
- **决定**：取消 SessionStart hook 对会话所在项目的自动初始化，改为惰性补齐：`kanban/` 结构仅在写操作（创建线程、设活跃等）或看板页面加载项目时自动补齐。
  **原因**：插件全局常驻后，自动初始化的副作用从单项目放大到所有项目，会在无关仓库中创建 `kanban/` 目录造成污染；写路径与页面加载本就有"结构缺失时自动补齐"的 spec 行为，改为惰性后体验无损。

## Changes

<!-- （可选）关联的 OpenSpec change 名字列表，仅当本线程使用 OpenSpec 工作流时才登记；不使用时留空即可。一行一条（仅名字，松耦合引用），例如：
- add-xxx
-->

- add-plugin-distribution
