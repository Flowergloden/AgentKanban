# 插件分发

status: 实现

<!-- 状态可选值：立项、规划、实现、完成。流转方式：直接修改上一行的 status 值。 -->

## 目标

规划 kanban 工作流的分发方式，包括安装、初始化、更新等

## 已完成的工作

<!-- 每完成一段工作，在此追加一条记录（含日期与概要），小需求一句话即可，无需关联 change。若使用 OpenSpec：属于本线程的 change 归档后，其蒸馏总结也追加在这里。 -->

- 2026-09-27：完成分发方式规划。盘点出工作流的三层组成（L1 约定层 / L2 数据层 / L3 工具层），确认 L2 已被插件初始化接口覆盖；确定目标架构：插件经 `systemPromptPath` 承载四条约定，经 GitHub Release 附件 zip + GitHub Action 自动发布。后续待办：改写 SYSTEM.md（全局条件式措辞）、移除本仓库 AGENTS.md 的 kanban 约定、编写发布 Action、修订 kanban-threads 与 kanban-viewer spec、验证 zip-url 安装的更新检测行为。
- 2026-09-27：方案定稿。SYSTEM.md 守卫措辞、GitHub Action 步骤（版本一致性校验、zip 打包、gh release 上传）、两个 spec 的修订点均已明确；新增决策见 ## 决策（惰性初始化）。创建 OpenSpec change `add-plugin-distribution` 进入实施准备。
- 2026-09-27：`add-plugin-distribution` 实施完成（12/12）。SYSTEM.md 随插件分发、ensure.mjs 改惰性初始化、仓库 AGENTS.md 删除、release.yml 流水线两次实跑成功（v0.2.0 / v0.2.1），本机安装源已从 local-path 切换为 zip-url。实测结论：zip-url 安装无更新提示、插件启用状态下不可覆盖安装（Windows 上运行中的看板服务锁住托管目录报 EBUSY），更新路径为"先结束服务进程再重装同一 latest URL"，已写入 v0.2.1 release notes。
- 2026-09-27（蒸馏自 `add-plugin-distribution` 归档）：动机是 kanban 工作流无法离开本仓库（约定锁在项目 AGENTS.md、插件只是 local-path 快照）。关键决定：四条约定迁入插件 SYSTEM.md 经 systemPromptPath 全局条件式注入；SessionStart 自动初始化改为惰性补齐以免污染无关项目；GitHub Release 附件 zip + tag 触发 Action 做分发；仓库 AGENTS.md 整体移除保持单一事实来源。完成情况：12/12 任务完成，v0.2.0/v0.2.1 两个版本经流水线发布，本机已切换 zip-url 安装并实测更新路径。
- 2026-09-27：探索"免杀进程更新"解法并完成根因定位。官方文档确认插件 hook 以插件根目录为 cwd 运行；ensure.mjs spawn 未传 cwd，常驻服务进程继承托管目录为工作目录，Windows 下该目录因此被钉死，覆盖安装必报 EBUSY——杀进程只是治标。选定根治方案：spawn 显式指定 cwd 到插件目录外 + /api/health 携带版本 + 新增 /api/shutdown 端点 + ensure.mjs 版本比对自动换代，预估约 30 行改动、零新依赖。另发现官方插件 kimi-cu-win 以同样方式中招，本修法可作范本。
- 2026-09-27：`fix-plugin-update-lock` 实施完成（7/7）并发布 v0.2.2。实测：服务运行中 rm -rf 托管目录并重装无 EBUSY（两次）；版本换代链路 0.2.2 → 0.2.3-dev → 0.2.2 全程单进程无报错；旧版（无 shutdown 端点）在线时新 ensure 静默退化复用；看板页面与接口正常。release notes 已改写为"直接重装 latest URL，无需杀进程"（注明从 0.2.1 升级是最后一次需手动杀进程）。
- 2026-09-27（蒸馏自 `fix-plugin-update-lock` 归档）：动机是插件覆盖安装必报 Windows EBUSY——服务进程继承插件根目录为 cwd 钉死托管目录，"先杀进程再重装"用户无好用手段。关键决定：spawn 显式 `cwd: os.tmpdir()` 一行根治目录锁；版本即换代信号（health 携带 manifest 版本，复用 release.yml 版本一致性校验保证每次发布版本必变）；换代协议只放 ensure.mjs（shutdown 请求 + 3 秒轮询 + 拉起新版），心跳路径不动；shutdown 端点语义最小化（先 200 再退出，无鉴权，与 TTL 机制并存）；旧版无 shutdown 能力时退化复用。完成情况：7/7 任务完成，v0.2.2 经流水线发布并实测免杀覆盖安装与自动换代，本机托管插件已升至 v0.2.2。

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
- **决定**：插件更新路径定为"先结束看板服务进程（或等其随会话退出），再重装恒定的 latest URL"，不做自动更新也不依赖管理器提示。
  **原因**：实测 zip-url 安装在插件管理器中无更新提示，且插件启用状态下覆盖安装被 Windows 文件锁拒绝（运行中的看板服务锁住托管目录，EBUSY）；恒定 URL + 杀进程重装的步骤简单可靠，已写入 release notes。
- **决定**：更新路径改为"免杀进程"（取代上一条）：服务进程 spawn 时显式指定 cwd 到插件托管目录外，根治 Windows 目录锁；配套版本换代机制——/api/health 携带版本、server 新增 /api/shutdown 端点、ensure.mjs 发现运行中服务版本不一致时先 shutdown 再拉起新版。
  **原因**：锁的根因是 hook 以插件根目录为 cwd 运行（官方行为）且 spawn 继承了它，杀进程只是治标且用户无好用手段；cwd 外置一行即可根治，版本换代解决重装后旧代码被新心跳续命常驻的问题，用户更新零额外操作。

## Changes

<!-- （可选）关联的 OpenSpec change 名字列表，仅当本线程使用 OpenSpec 工作流时才登记；不使用时留空即可。一行一条（仅名字，松耦合引用），例如：
- add-xxx
-->

- add-plugin-distribution
- fix-plugin-update-lock
