# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
