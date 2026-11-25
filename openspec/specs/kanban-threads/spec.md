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

每份 `thread.md` SHALL 由当前项目 schema 描述，并包含 `status`、`goal`、`completed`、`decisions`、`changes`、`dependencies` 六个核心字段；核心字段的默认 label 依次为 `status`、`目标`、`已完成的工作`、`决策`、`Changes`、`依赖`。决策字段的说明 SHALL 要求每条决策同时包含决定内容与原因。项目 SHALL 以 `kanban/thread.schema.json` 和程序生成器提供新建卷宗结构，不再以 `kanban/templates/thread.md` 作为创建依据。

#### Scenario: 从模板创建线程

- **WHEN** 用户通过项目默认 schema 创建新线程
- **THEN** 所得卷宗包含全部核心字段，用户只需填写目标即可投入使用

#### Scenario: 决策记录包含原因

- **WHEN** 一条决策被记入卷宗
- **THEN** 该条目同时包含"决定了什么"与"为什么"，使后续会话不会重提已被否决的方案

### Requirement: 线程依赖维度

线程卷宗 SHALL 通过核心 `dependencies` 字段支持可选线程依赖，以其默认 `## 依赖` 小节中的纯序号列表记录：一行一条，仅含被依赖线程的四位序号（如 `- 0002`）。依赖引用 MUST 仅使用序号，MUST NOT 使用目录名或 slug。依赖仅记录关系：MUST NOT 参与线程状态流转、完成约束或任何自动推导；条目 MUST NOT 携带注解或原因说明。`dependencies` SHALL 允许空值，存量卷宗缺失该小节 SHALL 视为无依赖且不构成格式异常。默认 schema SHALL 包含该字段及填写说明；`kanban/README.md` SHALL 说明依赖语义与手动维护方式。其他 reference 字段 SHALL 复用相同的线程引用语义，但不自动获得核心依赖的工作流含义。

#### Scenario: 记录依赖

- **WHEN** 在线程 A 卷宗的依赖字段中写入一行 `- 0002`
- **THEN** A 依赖线程 `0002`；A 的 status 流转与完成判断不受 `0002` 状态影响

#### Scenario: 重命名后引用保持稳定

- **WHEN** 被依赖线程由 `0002-foo` 重命名为 `0002-bar`
- **THEN** 各依赖方卷宗中的 `- 0002` 无需任何改动，仍指向该线程

#### Scenario: 依赖目标不存在

- **WHEN** 依赖字段引用的序号没有对应线程（如目标已删除）
- **THEN** 该引用视为悬空，不影响卷宗解析、校验与其他线程

#### Scenario: 缺少依赖小节的存量卷宗

- **WHEN** 一条既有线程的卷宗没有依赖小节
- **THEN** 该线程视为无依赖，卷宗校验不因缺该小节而报异常

### Requirement: 线程生命周期与当前指针

线程 SHALL 具有四个状态：`立项`、`规划`、`实现`、`完成`。状态流转 SHALL 由用户通过编辑卷宗中的 `status` 字段手动完成。系统 SHALL 通过 `kanban/current` 文件记录当前活跃线程的标识；该文件为空或不存在时，表示无活跃线程。

#### Scenario: 用户激活线程

- **WHEN** 用户将某线程的标识写入 `kanban/current`
- **THEN** 此后的会话将该线程视为当前活跃线程

#### Scenario: 用户流转状态

- **WHEN** 用户将卷宗中的 `status` 从 `立项` 改为 `规划`
- **THEN** 该线程即进入规划状态，无需其他系统动作

### Requirement: Agent 会话启动时读取当前线程

当 `kanban/current` 指向某条线程时，Agent SHALL 在会话开始阶段读取该线程的卷宗，向用户复述其对当前状态的理解。默认不请求确认，复述后即可按用户当前需求继续工作；仅当用户当前需求与线程内容存在显著分歧，且按当前需求继续可能造成严重后果时，Agent SHALL 请求用户确认或纠正，并尽可能通过 QA（结构化提问工具）提出。若活跃线程的 slug 精确命中保留标记值 `unnamed-pending`，Agent SHALL 在校准复述前自动完成命名。命名 MUST NOT 询问用户，且仅对当前活跃线程执行；命名结果 SHALL 在校准复述中一并报告。Agent SHALL 通过核心字段 key 及其当前文档映射识别目标、状态和依赖，不依赖可配置的显示 label。校准复述 SHALL 携带核心 `dependencies` 的直接依赖清单；相关元数据 SHALL 在消费时现取现拼，MUST NOT 复制进依赖方卷宗。推进线程期间 SHALL 按相关性渐进式展开依赖，MUST NOT 无条件加载整棵依赖闭包。

#### Scenario: 存在活跃线程

- **WHEN** 用户开启新会话且 `kanban/current` 指向线程 T
- **THEN** Agent 在正式工作前复述线程 T 的目标、当前进展与下一步，不例行请求确认或等待用户回复

#### Scenario: 高风险分歧时请求确认

- **WHEN** 用户当前需求与线程内容存在显著分歧，且按当前需求继续可能造成严重后果
- **THEN** Agent 在继续工作前请求用户确认或纠正，并尽可能通过 QA（结构化提问工具）提出

#### Scenario: 一般分歧不请求确认

- **WHEN** 用户当前需求与线程内容的分歧不显著，或继续工作不可能造成严重后果
- **THEN** Agent 不请求校准确认，按用户当前需求继续工作

#### Scenario: 活跃线程处于待命名状态

- **WHEN** 会话开始，且活跃线程的 slug 精确等于 `unnamed-pending`
- **THEN** Agent 先自动据卷宗标题生成英文 kebab-case slug 并调用重命名接口完成命名，随后在校准复述中报告命名结果，全程不询问用户

#### Scenario: 非活跃的待命名线程不处理

- **WHEN** 存在 slug 为 `unnamed-pending` 的线程，但它不是当前活跃线程
- **THEN** Agent 不对其执行命名，留待其被激活后的会话校准处理

#### Scenario: 无活跃线程

- **WHEN** `kanban/current` 为空或不存在
- **THEN** Agent 不执行线程校准，正常工作

#### Scenario: 校准时携带依赖清单

- **WHEN** 活跃线程的核心依赖字段列出若干依赖
- **THEN** 校准复述包含这些依赖线程的序号、标题与 status；悬空引用被明确标记

#### Scenario: 核心字段修改显示名

- **WHEN** schema 修改目标或依赖字段的 label，卷宗仍可通过稳定 key 或旧默认 label 映射
- **THEN** Agent 校准仍使用对应核心字段，不因显示名变化丢失目标或依赖

#### Scenario: 推进期间渐进式展开

- **WHEN** 推进活跃线程时 Agent 判断某依赖线程与当前任务相关
- **THEN** Agent 先读其目标字段，仍不足时再读完整卷宗，而非一次性加载全部依赖线程的卷宗

#### Scenario: 沿依赖链递归展开

- **WHEN** 被展开的依赖线程自身的核心依赖字段又指向其他线程
- **THEN** Agent 按同样的相关性判断逐层决定是否继续展开，不无条件加载整棵依赖闭包

### Requirement: 拐点时刻的捕获约定

对话中出现以下拐点时，Agent SHALL 询问用户是否需要记入当前线程卷宗：一个方向被否决、一个想法验证出结论、做出影响线程目标的决定、线程被搁置或重启。Agent MUST NOT 每轮都询问；用户拒绝后 MUST NOT 就同一事件再次追问。记录 SHALL 经用户确认后，按核心字段 key 定位当前卷宗中的决策或进展字段并追加，不得因字段 label 修改而写入错误小节。

#### Scenario: 方向被否决

- **WHEN** 对话中用户否定了某个探索方向
- **THEN** Agent 询问"要记入线程卷宗吗"；用户同意后，该方向与否决原因被追加到核心决策字段

#### Scenario: 用户拒绝记录

- **WHEN** Agent 询问是否记录而用户回答不用
- **THEN** Agent 不记录，且不就同一事件再次追问

### Requirement: 归档后的非侵入式蒸馏

当一个属于某线程的 OpenSpec change 完成归档后，Agent SHALL 从该 change 的工件蒸馏出一小段总结，按核心 `completed` key 定位并追加到所属线程的进展字段。所属关系 SHALL 由核心 `changes` 字段中的 change 名字确定；该字段为普通 Markdown，解析仅用于识别一行一个的 change 名称，不获得线程引用语义。该行为 SHALL 通过 kanban 插件注入的常驻约定提示；项目 `openspec/config.yaml` 的可选增强提示 SHALL 同样按核心 key 描述字段，MUST NOT 修改 OpenSpec 技能文件或 CLI。

#### Scenario: 归档属于线程的 change

- **WHEN** `openspec-archive-change` 流程完成，且被归档的 change 出现在某线程的核心 changes 字段中
- **THEN** Agent 将该 change 的动机、关键决定与完成情况蒸馏为一小段文字，追加到该线程的核心 completed 字段

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

系统 SHALL 在 `kanban/README.md` 提供操作文档，覆盖 schema 文件与核心/自定义字段、四类字段格式、视图清单及其字段绑定、创建线程、激活线程、手动记录、流转状态、关联 change、维护线程引用和维护文件引用。文档 SHALL 说明新卷宗由程序依据 schema 生成、既有模板不再作为创建依据、schema 修改不会自动迁移旧卷宗，以及文件路径仅指向项目内文件；用户 SHALL 仍能仅使用文本编辑器完成全部线程操作。

#### Scenario: 新用户学会操作

- **WHEN** 一个不了解本系统的用户阅读 `kanban/README.md`
- **THEN** 其能独立维护默认 schema 下的线程、激活线程、记录进展与流转状态，全程只需文本编辑器

#### Scenario: 用户配置自定义字段

- **WHEN** 用户希望增加一个 select、线程 reference 或 file 字段
- **THEN** 文档能指导其在 `thread.schema.json` 中配置 key、label、类型、说明及类型所需配置，并说明已有线程的兼容行为

#### Scenario: 用户手工维护文件引用

- **WHEN** 用户不通过看板页面而直接编辑卷宗中的 file 字段
- **THEN** 文档能指导其使用一行一个、`/` 分隔的项目相对路径，并说明去重、越界限制和允许引用暂时缺失的文件

### Requirement: 常驻约定由插件承载并条件适用

kanban 工作流的四条 Agent 常驻约定（会话校准、拐点捕获、归档蒸馏、便签人类专属）SHALL 由插件通过宿主支持的会话上下文注入形式承载，不再以项目内 AGENTS.md 或 CLAUDE.md 为载体；Kimi 使用 systemPrompt，Codex 使用已获信任的 SessionStart additionalContext，Claude Code 使用已启用插件的 SessionStart additionalContext。各宿主 SHALL 分发同一约定正文。约定 SHALL 采用全局条件式措辞：仅当当前项目根存在 kanban/ 时适用；不存在时 Agent MUST NOT 执行任何看板相关动作，也 MUST NOT 主动创建结构。运行模式切换与保活 MUST NOT 改变线程校准、待命名线程处理、捕获确认、防抖、归档蒸馏及便签人类专属语义。

#### Scenario: 看板项目中约定生效
- **WHEN** 项目根存在 kanban/ 且宿主已正常注入约定
- **THEN** Agent 按四条约定执行校准、拐点捕获、蒸馏和便签回避，与服务 auto/persistent 模式无关

#### Scenario: 非看板项目中约定不动作
- **WHEN** 项目根不存在 kanban/
- **THEN** Agent 不执行看板约定、不主动创建结构，正常工作

#### Scenario: 项目无 AGENTS.md 约定仍生效
- **WHEN** 看板项目没有 AGENTS.md 或 CLAUDE.md 约定但插件注入已就绪
- **THEN** Kimi、Codex 或 Claude Code 会话仍获得完整的四条约定，不向项目写入托管约定块

#### Scenario: 便签不进入宿主适配流程
- **WHEN** 启动 hook、活动 hook 或常驻控制执行
- **THEN** 不读取 kanban/note.md，不把便签内容注入上下文或用作控制依据

### Requirement: 项目级线程 Schema

系统 SHALL 在项目 `kanban/thread.schema.json` 中以有序字段列表和有序视图清单配置线程结构与页面入口。每个字段 SHALL 具有稳定 key、显示 label、类型和说明；核心字段 `status`、`goal`、`completed`、`decisions`、`changes`、`dependencies` MUST 各出现一次且保持规定类型，自定义字段 SHALL 使用受支持类型和不重复的 key。`views` SHALL 配置入口 key、label 及必要的字段绑定，MUST NOT 独立配置 `kind`；不携带 `fieldKey` 的唯一入口为 table，其他入口 MUST 根据目标字段类型分别呈现 select 看板或 reference 引用图。schema 缺失时 SHALL 使用承载旧实现的内置默认 schema；既有 schema 省略 `views` 时 SHALL 只在有效配置中补入默认三视图而不回写文件。schema 存在但字段或视图配置非法时 MUST 报告明确错误，MUST NOT 静默回退为默认 schema。

#### Scenario: 使用默认 schema

- **WHEN** 项目尚无自定义 `thread.schema.json`
- **THEN** 有效结构包含旧实现的六个核心字段，status 四态、各字段说明和依赖语义与旧模板一致，并显式包含全部字段表格、核心 status 看板和核心 dependencies 引用图三个视图

#### Scenario: 增加自定义字段

- **WHEN** 项目在核心字段之外增加一个 key 唯一的受支持类型字段
- **THEN** 新线程包含该字段，既有线程可将它读取为空值，核心字段的工作流语义不变，且不会仅因字段类型自动增加视图入口

#### Scenario: 配置有序视图清单

- **WHEN** 项目在 `views` 中配置表格、看板和引用图的 key、label、顺序及字段绑定
- **THEN** 有效 schema 按配置保留这些入口且不包含独立 kind，视图 key 不重复，table 不包含 fieldKey，非 table 的运行时类型由绑定字段类型推导

#### Scenario: 既有 schema 省略视图清单

- **WHEN** 本变更前生成的合法 schema 只有 `version` 和 `fields`
- **THEN** 读取结果补入默认三视图供页面使用，项目文件不被读取操作改写

#### Scenario: 核心字段被移除或类型不兼容

- **WHEN** schema 缺少任一核心字段，或为核心字段配置了规定之外的类型
- **THEN** 系统报告 schema 错误并拒绝依赖该 schema 的写操作，不把配置替换为默认 schema

#### Scenario: 字段 key 或 label 冲突

- **WHEN** 两个字段具有相同 key，或其 label 无法唯一映射到文档小节
- **THEN** 系统报告明确配置错误，不猜测字段对应关系

#### Scenario: 视图配置非法

- **WHEN** `views` 为空、缺少或重复 table、视图 key 重复、配置了独立 kind、非 table 的 `fieldKey` 重复，或视图绑定了缺失字段或不支持的 markdown 字段
- **THEN** 系统报告带视图位置的 schema 错误并拒绝相关写操作，不以默认视图替代非法配置

### Requirement: 线程字段类型语义

系统 SHALL 支持 `markdown`、`select`、`reference` 和 `file` 四种字段类型。markdown 保存普通 Markdown 内容；select 仅接受 schema 配置的一个选项；reference 仅保存有序、去重的四位线程序号列表；file 按“文件引用字段路径语义”保存项目文件。`changes` 核心字段 MUST 为 markdown，其 change 名称列表仅是字段说明与工作流约定，MUST NOT 被解析为 reference。

#### Scenario: Markdown 字段保存自由内容

- **WHEN** 用户或 Agent 向 markdown 字段写入列表、代码块或其他安全 Markdown 原文
- **THEN** 系统按原文保存内容，不套用引用或单选解析

#### Scenario: 单选字段拒绝配置外值

- **WHEN** 向 select 字段写入不属于其 options 的值
- **THEN** 系统拒绝该值且不修改卷宗

#### Scenario: 引用字段仅指向线程

- **WHEN** reference 字段包含有效、重复或悬空的四位线程序号
- **THEN** 解析结果按书写顺序保留有效序号与悬空序号并去重，消费方可统一提供线程跳转和引用图

#### Scenario: 文件字段使用独立语义

- **WHEN** file 字段包含项目相对文件路径
- **THEN** 系统按文件路径列表处理，不生成线程序号、线程跳转或线程引用边

#### Scenario: Changes 不获得引用类型行为

- **WHEN** `changes` 字段包含 `- add-example`
- **THEN** 该内容仅作为 Markdown 保存，不生成线程引用边或线程跳转链接

### Requirement: 文件引用字段路径语义

自定义 `file` 字段 SHALL 保存有序、去重的项目相对路径列表，每个路径使用 `/` 分隔并在卷宗中序列化为一行一条 `- <path>`。字段 SHALL 支持 `required` 和同格式的路径数组 `default`，缺省默认值为 `[]`；默认 schema MUST NOT 新增核心文件字段。保存引用 SHALL 只校验路径形式而不要求目标存在，file 字段 MUST NOT 绑定 board 或 graph 视图。

#### Scenario: 文件路径列表规范化

- **WHEN** 用户或 Agent 写入包含 Windows 分隔符、中文、空格和重复项的合法相对路径列表
- **THEN** 类型化值按首次出现顺序保留路径并去重，写回时统一使用 `/`，每个路径独占一个 Markdown 列表项

#### Scenario: 拒绝越界或绝对路径值

- **WHEN** 文件字段更新值包含空路径、绝对路径、驱动器路径、UNC 路径，或包含 `.`、`..` 路径段
- **THEN** 服务拒绝整个字段更新且不修改卷宗，不将非法值序列化进文件

#### Scenario: 解析既有文件字段

- **WHEN** 既有卷宗的 file 字段包含合法列表项、重复项、注释、非列表内容或形式非法的列表项
- **THEN** 类型化投影仅按顺序采纳合法路径并去重，原始内容保持不动，直至用户明确保存该字段

#### Scenario: 引用暂时不存在的文件

- **WHEN** 用户或 Agent 保存形式合法但目标当前不存在的项目相对路径
- **THEN** 引用保存成功，后续预览或实际读取时再明确报告目标缺失

#### Scenario: 文件字段默认值与必填校验

- **WHEN** schema 为 file 字段配置路径数组 default 或 required，或创建一个必填文件字段仍为空
- **THEN** 默认值按相同路径规则规范化和去重，必填空值被拒绝，未配置 default 的字段以空列表创建

#### Scenario: 既有卷宗缺少文件字段

- **WHEN** 当前 schema 新增 file 字段而既有卷宗没有对应小节
- **THEN** 该字段投影为空列表，磁盘原文不变，首次保存时按既有字段补建规则添加小节与稳定 key 标记

#### Scenario: 文件字段绑定非表格视图

- **WHEN** `views` 中的非表格入口绑定 file 字段
- **THEN** schema 校验明确拒绝该配置，不以看板或引用图解释文件路径；合法 file 字段仍可在表格和详情中使用

### Requirement: 创建时生成字段说明

系统 SHALL 按 schema 程序化生成新卷宗的字段、顺序、默认值和字段标记，并将各字段说明及选项等实例配置生成到对应位置的 Markdown 注释。字段类型的通用约束 SHALL 静态维护在插件 `SYSTEM.md`；Agent SHALL 结合该静态约束与卷宗内字段说明工作，系统 MUST NOT 为拼接提示引入运行时接口。schema 后续修改 MUST NOT 为刷新注释而自动改写既有卷宗。

#### Scenario: 新卷宗携带字段说明

- **WHEN** 使用包含自定义 select 字段的 schema 创建线程
- **THEN** 新卷宗按配置顺序包含该字段、稳定 key 标记、说明与选项注释，字段值采用配置默认值或空值

#### Scenario: 新卷宗生成文件字段

- **WHEN** 使用包含自定义 file 字段的 schema 创建线程
- **THEN** 新卷宗包含该字段、稳定 key 标记和实例说明，字段值采用规范化路径默认值或空列表，不要求目标文件已经存在

#### Scenario: 修改说明不重写旧卷宗

- **WHEN** 项目修改某字段的 description 后读取既有卷宗
- **THEN** 既有卷宗保持原样，当前 schema 仍用于解析和校验，新创建卷宗使用更新后的说明

#### Scenario: 类型约束随插件静态分发

- **WHEN** Agent 在任一受支持宿主中处理 schema 驱动的卷宗
- **THEN** 同一 `SYSTEM.md` 提供 markdown、select、reference、file 的通用约束，无需调用提示生成服务

### Requirement: Schema 与既有卷宗不一致时保留原文

系统 SHALL 以当前 schema 投影既有卷宗，对新增字段返回空值，对缺失或歧义字段给出可识别状态。schema 外小节和无法映射的原始内容 MUST 保留，并在详情中显式标记；除用户明确更新目标字段外，系统 MUST NOT 自动迁移、重排或重写整份卷宗。

#### Scenario: Schema 新增字段

- **WHEN** 既有卷宗缺少当前 schema 新增的字段
- **THEN** 该字段在表格和详情中显示为空或缺失状态，其他字段正常读取，磁盘原文不变

#### Scenario: Schema 移除自定义字段

- **WHEN** 既有卷宗仍包含已不在 schema 中的自定义小节
- **THEN** 该小节作为未映射内容保留并显式标记，更新其他字段时其标题、注释和正文均不丢失

#### Scenario: 核心字段显示名变化

- **WHEN** 新卷宗通过稳定 key 标记映射字段，而 schema 修改其 label
- **THEN** 系统仍按 key 识别该字段，无需迁移卷宗正文
