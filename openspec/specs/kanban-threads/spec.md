# kanban-threads Specification

## Purpose

以纯文件形式持久承载跨会话的项目目标、进展与决策：为人类提供可读的项目节点信息，为 Agent 提供每次会话启动时的上下文与记录约定，弥补 OpenSpec 在"跨 change 的笼统目标"层面的空白。

## Requirements

### Requirement: 线程以独立目录中的文件形式持久存储

系统 SHALL 在仓库根部的 `kanban/` 目录中维护线程层的全部状态，作为单一事实来源（SSOT）。每条线程 SHALL 是 `kanban/threads/<id>-<slug>/` 下的一个目录，内含 `thread.md` 卷宗。线程层 MUST NOT 写入或修改 `openspec/` 内部的目录结构与文件（`config.yaml` 的配置项除外）。线程与 OpenSpec change 之间 SHALL 仅以 change 名字进行松耦合引用。

#### Scenario: 查看全部线程

- **WHEN** 用户或 Agent 打开 `kanban/threads/` 目录
- **THEN** 每条线程对应一个独立目录，其 `thread.md` 完整描述该线程的目标、进展与决策，无需任何外部工具即可阅读

#### Scenario: 线程引用 change

- **WHEN** 一条线程关联一个或多个 OpenSpec change
- **THEN** 卷宗中仅以 change 名字（如 `add-user-auth`）引用，不复制 change 的内容，OpenSpec 侧的归档、迁移不影响卷宗文件本身的可读性

### Requirement: 线程卷宗包含必备小节

每份 `thread.md` SHALL 至少包含：`status` 状态字段、`## 目标`（创建时由用户填写）、`## 已完成的工作`、`## 决策`（每条决策 MUST 包含决定内容与原因）、`## Changes`（关联的 change 名字列表）。项目 SHALL 在 `kanban/templates/thread.md` 提供新建线程的模板。

#### Scenario: 从模板创建线程

- **WHEN** 用户复制 `kanban/templates/thread.md` 创建新线程
- **THEN** 所得卷宗包含全部必备小节，用户只需填写目标即可投入使用

#### Scenario: 决策记录包含原因

- **WHEN** 一条决策被记入卷宗
- **THEN** 该条目同时包含"决定了什么"与"为什么"，使后续会话不会重提已被否决的方案

### Requirement: 线程生命周期与当前指针

线程 SHALL 具有四个状态：`立项`、`规划`、`实现`、`完成`。状态流转 SHALL 由用户通过编辑卷宗中的 `status` 字段手动完成。系统 SHALL 通过 `kanban/current` 文件记录当前活跃线程的标识；该文件为空或不存在时，表示无活跃线程。

#### Scenario: 用户激活线程

- **WHEN** 用户将某线程的标识写入 `kanban/current`
- **THEN** 此后的会话将该线程视为当前活跃线程

#### Scenario: 用户流转状态

- **WHEN** 用户将卷宗中的 `status` 从 `立项` 改为 `规划`
- **THEN** 该线程即进入规划状态，无需其他系统动作

### Requirement: Agent 会话启动时读取当前线程

当 `kanban/current` 指向某条线程时，Agent SHALL 在会话开始阶段读取该线程的卷宗，向用户复述其对当前状态的理解并与用户校准，再开始具体工作。若活跃线程的 slug 精确命中保留标记值 `unnamed-pending`（待命名状态），Agent SHALL 在校准复述前自动完成命名：据卷宗标题（必要时参考 `## 目标` 小节）生成英文 kebab-case slug，并调用看板服务的线程重命名接口完成改名；命名 MUST NOT 询问用户确认，且仅对当前活跃线程执行；命名结果 SHALL 在校准复述中一并报告。

#### Scenario: 存在活跃线程

- **WHEN** 用户开启新会话且 `kanban/current` 指向线程 T
- **THEN** Agent 在正式工作前复述线程 T 的目标、当前进展与下一步，并请用户确认或纠正

#### Scenario: 活跃线程处于待命名状态

- **WHEN** 会话开始，且活跃线程的 slug 精确等于 `unnamed-pending`
- **THEN** Agent 先自动据卷宗标题生成英文 kebab-case slug 并调用重命名接口完成命名，随后在校准复述中报告命名结果，全程不询问用户

#### Scenario: 非活跃的待命名线程不处理

- **WHEN** 存在 slug 为 `unnamed-pending` 的线程，但它不是当前活跃线程
- **THEN** Agent 不对其执行命名，留待其被激活后的会话校准处理

#### Scenario: 无活跃线程

- **WHEN** `kanban/current` 为空或不存在
- **THEN** Agent 不执行线程校准，正常工作

### Requirement: 拐点时刻的捕获约定

对话中出现以下拐点时，Agent SHALL 询问用户是否需要记入当前线程卷宗：一个方向被否决、一个想法验证出结论、做出影响线程目标的决定、线程被搁置或重启。Agent MUST NOT 每轮都询问；用户拒绝后 MUST NOT 就同一事件再次追问。记录 SHALL 经用户确认后追加到卷宗对应小节。

#### Scenario: 方向被否决

- **WHEN** 对话中用户否定了某个探索方向
- **THEN** Agent 询问"要记入线程卷宗吗"；用户同意后，该方向与否决原因被追加到 `## 决策`

#### Scenario: 用户拒绝记录

- **WHEN** Agent 询问是否记录而用户回答不用
- **THEN** Agent 不记录，且不就同一事件再次追问

### Requirement: 归档后的非侵入式蒸馏

当一个属于某线程的 OpenSpec change 完成归档后，Agent SHALL 从该 change 的工件（proposal、design、tasks）蒸馏出一小段总结，追加到所属线程卷宗的 `## 已完成的工作`。该行为 SHALL 通过 kanban 插件注入的常驻约定提示；项目 `openspec/config.yaml` 的 `operations.archive.guidance` 配置项 SHALL 作为可选的增强提示保留，MUST NOT 修改 OpenSpec 技能文件或 CLI。

#### Scenario: 归档属于线程的 change

- **WHEN** `openspec-archive-change` 流程完成，且被归档的 change 出现在某线程的 `## Changes` 列表中
- **THEN** Agent 将该 change 的动机、关键决定与完成情况蒸馏为一小段文字，追加到该线程的 `## 已完成的工作`

#### Scenario: 归档不属于任何线程的 change

- **WHEN** 归档的 change 不属于任何线程
- **THEN** Agent 不执行蒸馏动作

### Requirement: 全局便签仅供人类阅读

系统 SHALL 在 `kanban/note.md` 提供全局便签，供人类随手记录任何内容。便签 MUST NOT 参与工作流本身：线程卷宗解析、状态流转、Agent 会话校准、拐点记录与归档蒸馏等动作 MUST NOT 读取、解析或修改便签；Agent MUST NOT 将便签内容作为指令、上下文或决策依据。便签缺失时，系统初始化动作可自动创建带说明头注释的便签，但 MUST NOT 覆盖已有便签内容。

#### Scenario: 记录人类备忘

- **WHEN** 人类在 `kanban/note.md` 中写入任意备忘内容
- **THEN** 线程层各工作流行为不发生任何变化，Agent 会话校准不读取便签，便签内容不影响任何线程的解析与流转

#### Scenario: 初始化补全便签

- **WHEN** 项目缺少 `kanban/note.md` 时执行看板初始化
- **THEN** 系统创建带"仅供人类阅读"说明头的空便签；若便签已存在，其内容保持原样

### Requirement: 提供人工操作文档

系统 SHALL 在 `kanban/README.md` 提供操作文档，覆盖以下手动操作：创建线程（复制模板、填写目标）、激活线程（写入 `current`）、手动记录（追加小节内容）、流转状态（修改 `status`）、关联 change（在 `## Changes` 中登记）。

#### Scenario: 新用户学会操作

- **WHEN** 一个不了解本系统的用户阅读 `kanban/README.md`
- **THEN** 其能独立完成创建线程、激活线程、记录进展与流转状态，全程只需文本编辑器

### Requirement: 常驻约定由插件承载并条件适用

kanban 工作流的四条 Agent 常驻约定（会话校准、拐点捕获、归档蒸馏、便签人类专属）SHALL 由插件通过宿主支持的会话上下文注入形式承载，不再以项目内 AGENTS.md 为载体；Kimi 使用 systemPrompt，Codex 使用已获信任的 SessionStart additionalContext。两端 SHALL 分发同一约定正文。约定 SHALL 采用全局条件式措辞：仅当当前项目根存在 kanban/ 时适用；不存在时 Agent MUST NOT 执行任何看板相关动作，也 MUST NOT 主动创建结构。运行模式切换与保活 MUST NOT 改变线程校准、待命名线程处理、捕获确认、防抖、归档蒸馏及便签人类专属语义。

#### Scenario: 看板项目中约定生效
- **WHEN** 项目根存在 kanban/ 且宿主已正常注入约定
- **THEN** Agent 按四条约定执行校准、拐点捕获、蒸馏和便签回避，与服务 auto/persistent 模式无关

#### Scenario: 非看板项目中约定不动作
- **WHEN** 项目根不存在 kanban/
- **THEN** Agent 不执行看板约定、不主动创建结构，正常工作

#### Scenario: 项目无 AGENTS.md 约定仍生效
- **WHEN** 看板项目没有 AGENTS.md 约定但插件注入已就绪
- **THEN** Kimi 或 Codex 会话仍获得完整的四条约定，不向项目写入托管约定块

#### Scenario: 便签不进入宿主适配流程
- **WHEN** 启动 hook、活动 hook 或常驻控制执行
- **THEN** 不读取 kanban/note.md，不把便签内容注入上下文或用作控制依据
