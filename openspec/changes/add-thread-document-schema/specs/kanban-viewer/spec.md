# Spec Delta

## ADDED Requirements

### Requirement: 看板表格的字段化编辑

看板基础表格 SHALL 为每个 schema 字段提供与其类型匹配的单元格编辑能力，并通过同一字段更新协议写回目标卷宗。markdown 字段 SHALL 复用 Live Preview、自动保存和三方合并；select 字段 SHALL 提供选项选择；reference 字段 SHALL 提供线程引用的增删、跳转与悬空显示。编辑失败或冲突时 MUST 保留本地草稿或操作前内容，MUST NOT 静默覆盖外部修改。

#### Scenario: 编辑 Markdown 单元格

- **WHEN** 用户从表格中的 markdown 单元格展开编辑器并修改内容
- **THEN** 页面使用统一 Live Preview 编辑表面自动保存该字段，表格摘要与详情保持一致

#### Scenario: 编辑单选单元格

- **WHEN** 用户在 select 单元格中选择另一配置选项
- **THEN** 仅该字段被更新，非法选项无法通过界面提交，成功后所有相关视图反映新值

#### Scenario: 编辑线程引用单元格

- **WHEN** 用户在 reference 单元格中添加或移除线程引用
- **THEN** 对应序号列表被写回，现有引用可点击跳转，悬空序号保留原始标识

#### Scenario: 单元格保存冲突

- **WHEN** 单元格写回时服务端返回 409
- **THEN** 页面明确提示文件已被修改并保留可恢复的编辑上下文，不将失败操作显示为成功

## MODIFIED Requirements

### Requirement: 线程列表与详情查询接口

服务 SHALL 按项目当前 schema 解析线程卷宗。列表接口 SHALL 返回有效 schema、每条线程的标识、标题、最近更新时间、文件指纹、是否活跃，以及按字段 key 组织的类型化值；核心 goal 摘要、status 和 dependencies 投影 SHALL 从对应核心字段派生。详情接口 SHALL 返回各字段的类型化值与用于编辑的原始净内容，并返回 schema 外小节的未映射标记及原文。旧 `status`、`goalExcerpt`、`deps` 和按 label 组织的 `sections` 响应字段 SHALL 在兼容适配期内继续提供。卷宗或 schema 异常 SHALL 返回明确状态，不影响无关项目。

#### Scenario: 查询线程列表

- **WHEN** 项目存在若干符合当前 schema 的线程卷宗
- **THEN** 接口返回每条线程的系统元数据、全部字段值和文件指纹，并正确标记活跃线程

#### Scenario: 列表投影携带依赖

- **WHEN** 线程 A 的核心 dependencies 字段包含 `- 0002` 与 `- 0004`
- **THEN** 列表字段投影中 A 的 dependencies 为 `["0002", "0004"]`，兼容字段 deps 保持相同值

#### Scenario: 无依赖时投影为空列表

- **WHEN** 某线程没有依赖小节，或核心 dependencies 字段内容为空
- **THEN** 该线程的 dependencies 与兼容 deps 投影均为空列表

#### Scenario: 自定义字段进入列表投影

- **WHEN** schema 包含自定义 select 或 reference 字段
- **THEN** 每条线程的字段投影按稳定 key 返回对应标量或线程序号列表，前端无需按显示 label 猜测类型

#### Scenario: 兼容旧列表消费方

- **WHEN** 旧消费方读取默认 schema 项目的列表响应
- **THEN** 仍可读取 status、goalExcerpt 与 deps，其值分别来自核心 status、goal 和 dependencies 字段

#### Scenario: 查询线程详情

- **WHEN** 查询某条存在线程的详情
- **THEN** 接口返回其标题、全部 schema 字段的原始净内容与类型化值、未映射小节和文件指纹

#### Scenario: 小节内容为净内容

- **WHEN** 查询某线程详情，其卷宗字段内容前后带有排版空行
- **THEN** 接口返回的字段原始内容首尾不含这些结构性空行

#### Scenario: 旧模板注释不作为字段值展示

- **WHEN** 既有卷宗字段仅含旧模板说明注释，或注释与正式内容并存
- **THEN** 类型化投影和表格展示忽略这些说明注释，原始文件不被读取操作修改

#### Scenario: 未映射小节随详情返回

- **WHEN** 卷宗包含当前 schema 外的小节
- **THEN** 详情响应携带其原始标题与内容并标记未映射，不把内容并入其他字段

#### Scenario: 线程目录缺少卷宗

- **WHEN** 某线程目录下不存在 `thread.md`
- **THEN** 该线程在列表中以“卷宗缺失”状态呈现，不影响其他线程的返回

### Requirement: 线程小节更新接口（乐观并发）

服务 SHALL 提供按稳定字段 key 更新线程卷宗的接口：请求携带线程标识、字段 key、符合字段类型的值或 Markdown 原始净内容，以及读取时获得的文件指纹。服务 MUST 在写盘前校验指纹与字段值；指纹不匹配时返回 409，非法 select 或 reference 值返回明确错误，均不写盘。匹配时 SHALL 仅替换目标字段，其他字段、注释及未映射小节一字不改，并原子写盘。卷宗缺失目标字段时 SHALL 按当前 schema 补建该字段及标记；旧 section/status 接口 SHALL 在兼容适配期内映射到同一字段更新语义。

#### Scenario: 指纹匹配时更新成功

- **WHEN** 更新请求携带的指纹与当前文件一致且字段值合法
- **THEN** 目标字段被替换，文件其余部分保持不变，接口返回成功与新的文件指纹

#### Scenario: 写回恢复规范空行

- **WHEN** 更新请求携带的 Markdown 净内容首尾没有空行
- **THEN** 落盘后的字段标题之后、字段末尾与下一标题之间各保留一个空行

#### Scenario: 指纹不匹配时拒绝写入

- **WHEN** 请求指纹与当前文件不一致
- **THEN** 接口返回 409 冲突状态，文件内容不发生任何变化

#### Scenario: 拒绝非法字段值

- **WHEN** select 值不在 options 中，或 reference 值不是线程序号列表
- **THEN** 接口返回明确错误且不写盘，不将非法值序列化进卷宗

#### Scenario: 更新不存在的小节或线程

- **WHEN** 请求指向不存在的线程，或当前 schema 未配置的字段 key
- **THEN** 接口返回明确错误状态，文件不发生任何变化

#### Scenario: 依赖小节缺失时自动补建

- **WHEN** 更新目标为当前 schema 已配置但卷宗中缺失的字段，且指纹匹配
- **THEN** 服务按 schema 顺序或文档末尾的确定规则补建字段与稳定 key 标记后写入内容，其他原文保持不变

#### Scenario: 旧小节接口使用默认 schema

- **WHEN** 旧消费方以默认 label 调用 section 或 status 更新接口
- **THEN** 服务将其映射到对应核心字段并沿用相同校验、并发与写盘行为

### Requirement: kanban 结构初始化与惰性补齐

服务 SHALL 提供初始化接口：仅对已注册项目创建 `kanban/`、`kanban/threads/`、`kanban/thread.schema.json`、空 `kanban/current` 与带人类专属说明的 `kanban/note.md`；新项目 MUST NOT 再创建 `kanban/templates/` 或 `kanban/templates/thread.md`。初始化 MUST 幂等，已存在文件不得被覆盖。既有模板 SHALL 原样保留但不再作为创建依据。插件 SessionStart hook 和普通页面加载 MUST NOT 自动初始化；已注册项目的线程创建、活跃切换等写操作在结构缺失时 SHALL 自动补齐。

#### Scenario: 初始化空白项目

- **WHEN** 用户在已注册但没有 `kanban/` 的项目页面选择初始化
- **THEN** 服务创建包含默认 schema 的最小看板结构，不创建模板目录或模板文件，响应列出新创建的 schema 等文件

#### Scenario: 未确认路径拒绝初始化

- **WHEN** 对待确认、已忽略或未登记路径调用初始化或其他会创建看板结构的写接口
- **THEN** 服务返回明确错误，项目文件系统不发生任何变化

#### Scenario: 页面加载自动初始化

- **WHEN** 页面加载或切换到已注册但没有 `kanban/` 的项目
- **THEN** 页面显示“初始化”和“忽略”选项，不在选择前自动创建结构

#### Scenario: 重复初始化幂等

- **WHEN** 对已具备完整结构的已注册项目再次调用初始化接口
- **THEN** 不创建、不修改任何已有路径与文件，返回空的新建列表

#### Scenario: 旧项目补齐 schema

- **WHEN** 已有看板项目包含模板和卷宗但缺少 `thread.schema.json`，随后发生需要补齐结构的写操作
- **THEN** 服务仅补齐默认 schema 等缺失结构，旧模板与所有卷宗保持不变

#### Scenario: 会话启动不初始化项目

- **WHEN** 某项目的宿主会话启动并完成自动发现或显式确认，且该项目不存在 `kanban/` 结构
- **THEN** 该项目的文件系统不发生任何变化，`kanban/` 结构不会被创建

#### Scenario: 旧版服务降级

- **WHEN** 用户在连接旧版服务的页面显式选择初始化，而服务不支持该接口
- **THEN** 页面报告无法初始化，不静默声称成功，其余只读功能保持可用

#### Scenario: 写操作缺结构自动补齐

- **WHEN** 已注册项目缺少 kanban 结构时发起线程创建或活跃线程切换
- **THEN** 服务先自动补齐缺失的目录、默认 schema 与文件，再完成操作

### Requirement: 线程创建与删除接口

服务 SHALL 提供线程创建接口：请求携带线程标题，允许携带写入核心 goal 字段的目标描述；目标描述非字符串或超过 5000 字符时 MUST 返回错误。服务 SHALL 分配序号与 slug，按当前 schema 程序化生成卷宗，写入标题、核心 status 默认值、字段说明注释与稳定 key 标记；提供目标描述时 SHALL 写入核心 goal 字段，不再读取项目模板。待命名 slug、保留字和冲突规则保持既有行为。服务 SHALL 提供线程删除接口：删除整个线程目录；若被删除的是当前活跃线程，SHALL 同时清空 `kanban/current`。删除为真删，不提供回收站。

#### Scenario: 创建线程

- **WHEN** 以标题“用户认证”创建线程，且已有最大序号为 `0002`
- **THEN** 新线程目录为 `0003-<slug>`，卷宗由当前 schema 生成，标题已填写，核心 status 为其默认值

#### Scenario: 项目自有模板缺失时使用内置模板

- **WHEN** 旧项目仍缺少模板文件，或新项目从未创建模板文件
- **THEN** 服务使用内置默认 schema 生成包含六个核心字段、原状态选项与字段说明的卷宗，不读取或补建模板

#### Scenario: 自定义 schema 生成字段注释

- **WHEN** 当前 schema 包含带说明和选项的自定义 select 字段
- **THEN** 新卷宗按字段顺序包含该小节、稳定 key 标记、说明和选项注释

#### Scenario: 中英文标题留空 slug 均创建为待命名线程

- **WHEN** 分别以中文标题和英文标题创建线程且 slug 留空
- **THEN** 两条新线程目录的 slug 均为 `unnamed-pending`，创建成功且不从标题自动生成

#### Scenario: 多条待命名线程共存

- **WHEN** 已存在一条待命名线程，再以另一标题创建线程且 slug 留空
- **THEN** 新线程获得下一序号并继续使用 `unnamed-pending` 占位，不因 slug 相同而报错

#### Scenario: 保留字拒绝显式使用

- **WHEN** 调用方创建线程时显式指定 `unnamed-pending` 为 slug
- **THEN** 接口返回错误且不创建线程

#### Scenario: 空白项目直接创建线程

- **WHEN** 在一个没有任何 kanban 结构的项目中直接发起线程创建
- **THEN** 服务自动创建包含默认 schema 的看板结构并完成线程创建，不再创建或要求模板

#### Scenario: 创建时携带目标描述

- **WHEN** 以标题“用户认证”与目标描述“打通登录与注册”创建线程
- **THEN** 卷宗核心 goal 字段内容为该描述，其余字段保持生成默认值和说明注释

#### Scenario: 目标描述非法

- **WHEN** 创建线程时目标描述为非字符串，或超过 5000 字符
- **THEN** 接口返回错误，不创建线程目录

#### Scenario: 删除普通线程

- **WHEN** 用户删除一条非活跃线程
- **THEN** 其线程目录被移除，`kanban/current` 不受影响

#### Scenario: 删除活跃线程

- **WHEN** 删除的线程正是 `kanban/current` 指向的活跃线程
- **THEN** 线程目录被移除，且 `kanban/current` 被清空

### Requirement: 看板页面的线程视图

页面 SHALL 按有效 `schema.views` 的配置顺序展示视图入口，并使用配置 label；MUST NOT 遍历字段类型自动派生额外入口。唯一不携带 `fieldKey` 的 table 配置对应全部线程基础表格，表格按 schema 顺序展示全部字段及标识、标题、最近更新等系统列。其他入口 SHALL 根据目标字段 `type` 推导运行时 kind：select 对应 board，reference 对应 graph；配置本身 MUST NOT 携带独立 kind。board 入口 SHALL 仅读取其绑定的 select 字段并按 options 分组，graph 入口 SHALL 仅读取其绑定的 reference 字段建图；默认 schema 显式配置 status 看板与 dependencies 引用图。活跃线程在各视图中 SHALL 有明显标识，看板拖拽 SHALL 更新其分组字段。当前视图选择 SHALL 仅保留在页面状态中，MUST NOT 写入 schema、URL 或 localStorage；本变更不提供通用筛选或自定义视图插件，固定“未完成”视图 SHALL 移除。项目切换与既有 URL 项目定位行为保持不变。

#### Scenario: 基础表格展示全部字段

- **WHEN** 用户打开使用自定义 schema 的项目
- **THEN** 配置的表格按字段配置顺序显示核心与自定义字段，长 Markdown 以摘要呈现，字段类型由 schema 决定

#### Scenario: 视图名称与顺序由配置决定

- **WHEN** 项目在 `views` 中调整入口 label 和排列顺序
- **THEN** 页面严格按该顺序显示配置名称，不再使用“看板：字段名”或“引用图：字段名”的程序拼接名称

#### Scenario: 自定义字段不自动产生视图

- **WHEN** schema 新增 select 或 reference 字段但未在 `views` 中配置对应入口
- **THEN** 字段仍出现在表格和详情中，页面不自动增加看板或引用图入口

#### Scenario: 切换视图

- **WHEN** 用户在基础表格、已配置的看板或引用图之间切换
- **THEN** 页面展示当前配置对应的视图；看板使用绑定字段的 options 分列，引用图使用绑定字段的引用建图

#### Scenario: 拖拽流转状态

- **WHEN** 用户在核心 status 看板中将卡片从“立项”列拖入“实现”列
- **THEN** 仅该线程的核心 status 字段被更新为“实现”，卡片显示在“实现”列

#### Scenario: 从引用字段切换图形视图

- **WHEN** 用户选择绑定任一 reference 字段的图形视图
- **THEN** 页面根据该字段的线程序号列表渲染引用图，而非固定读取核心 dependencies

#### Scenario: 默认视图入口

- **WHEN** 项目使用默认 schema，或既有合法 schema 省略 `views`
- **THEN** 有效配置提供全部字段表格、核心 status 看板和核心 dependencies 引用图，不提供固定未完成筛选视图；缺省补全不回写项目文件

#### Scenario: 当前视图配置失效

- **WHEN** 外部修改 schema 后，当前入口被移除、fieldKey 改变、绑定字段不再存在或类型变化导致推导 kind 改变
- **THEN** 页面回退到配置的表格并显示明确提示，不继续向旧字段写入

#### Scenario: 当前视图选择不持久化

- **WHEN** 用户选择非表格视图后刷新页面或切换项目
- **THEN** 页面从配置的表格视图开始，不把最后选择写入项目文件、URL 或浏览器存储；引用图节点位置的既有独立持久化不受此限制

#### Scenario: 活跃线程标识

- **WHEN** 某线程是 `kanban/current` 指向的活跃线程
- **THEN** 它在各视图中带有明确的活跃标识

### Requirement: 依赖图视图

看板页面 SHALL 将任一 reference 字段呈现为线程引用图：以全部线程为节点，按核心 status 着色并高亮活跃线程，以所选字段的序号列表派生有向边，箭头指向被引用方。引用数据 MUST 全部派生自字段投影，不引入新的存储。视图 SHALL 保留自动分层、节点拖动、连线增删引用、自引用拦截、成环标记和悬空幽灵节点。节点位置 SHALL 按项目根、字段 key 与线程标识持久化于浏览器 localStorage，MUST NOT 写入 `kanban/`。点击实体节点 SHALL 跳转对应线程详情。

#### Scenario: 依赖图派生渲染

- **WHEN** 线程 A 的所选 reference 字段包含线程 B 的序号
- **THEN** 图中 A 与 B 各为一个节点，存在从 A 指向 B 的有向边

#### Scenario: 非核心引用字段建图

- **WHEN** 用户选择自定义 reference 字段
- **THEN** 图仅根据该字段建边，核心 dependencies 不被混入

#### Scenario: 自动分层布局

- **WHEN** 打开引用图视图
- **THEN** 被引用方按引用深度位于引用方上层；活跃线程高亮，各节点按核心 status 着色

#### Scenario: 节点位置持久化

- **WHEN** 用户在一个引用图中拖动节点后切换到另一 reference 字段或刷新页面
- **THEN** 各图恢复各自的节点位置，`kanban/` 下任何文件不因拖拽而变化

#### Scenario: 连线建立依赖

- **WHEN** 用户从节点 A 拖拽连线到节点 B 并确认落线
- **THEN** B 的序号经字段更新接口写入 A 的所选 reference 字段，缺字段时由接口补建，图中出现 A→B

#### Scenario: 拒绝自依赖连线

- **WHEN** 用户将连线落回起点节点自身
- **THEN** 不建立引用，不发生写操作

#### Scenario: 删除依赖连线

- **WHEN** 用户点选已有边 A→B 并确认删除
- **THEN** B 的序号仅从 A 的所选 reference 字段移除，该边消失

#### Scenario: 闭环标记

- **WHEN** 所选字段的引用关系构成环路
- **THEN** 环路上的节点与边以醒目样式标记，视图与线程流转均不受其他影响

#### Scenario: 悬空引用渲染为幽灵节点

- **WHEN** 所选字段含无对应线程的序号
- **THEN** 图中以可辨识的幽灵样式呈现该序号节点及其入边，不影响其他节点渲染

#### Scenario: 点击节点跳转详情

- **WHEN** 用户点击引用图中的某实体节点
- **THEN** 页面切换到该线程的详情视图

### Requirement: 看板页面的线程详情与分小节编辑

页面 SHALL 提供 schema 驱动的线程详情视图，按配置顺序和 label 展示全部字段。markdown 字段 SHALL 使用安全渲染和统一 Live Preview；select 字段 SHALL 通过选项控件编辑；reference 字段 SHALL 将有效序号渲染为线程标题链接并标记悬空引用。核心 goal 保持随手可改，其他字段默认只读并在点击“编辑”后解锁。所有编辑 SHALL 保留自动保存、最新指纹与冲突处理。schema 外小节 SHALL 以未映射状态只读展示并保留原文。详情视图 SHALL 提供设置/取消活跃线程与核心 status 流转入口。

#### Scenario: 详情字段由 schema 决定

- **WHEN** 用户打开包含自定义字段的线程详情
- **THEN** 页面按当前 schema 顺序显示核心与自定义字段，不再使用固定小节数组

#### Scenario: 目标随手可改

- **WHEN** 用户在详情页编辑核心 goal 字段并停止输入
- **THEN** Live Preview 更新，该字段自动保存，页面显示新内容、最新指纹与已保存状态

#### Scenario: Agent 生成小节默认锁定

- **WHEN** 用户查看非核心 goal 的任一字段
- **THEN** 该字段默认只读，点击“编辑”后才变为可编辑

#### Scenario: 依赖小节默认锁定且可编辑

- **WHEN** 用户查看并编辑核心 dependencies 或其他 reference 字段
- **THEN** 字段默认只读，点击“编辑”后通过引用控件解锁编辑，不要求手写序号列表

#### Scenario: 单选与引用字段使用类型编辑器

- **WHEN** 用户编辑 select 或 reference 字段
- **THEN** 页面提供对应选项控件或线程引用编辑，不要求用户手写底层序列化格式

#### Scenario: 依赖条目渲染为可点击链接

- **WHEN** 查看的 reference 字段含有效线程序号
- **THEN** 该条目显示目标线程序号与标题，点击后跳转到对应线程详情

#### Scenario: 悬空依赖显示标记

- **WHEN** reference 字段含不存在的线程序号
- **THEN** 该条目显示悬空标记与原始序号，不渲染为有效线程链接

#### Scenario: 未映射小节只读保留

- **WHEN** 卷宗包含当前 schema 外的小节
- **THEN** 详情明确标记并展示其原始内容，不提供会绕过 schema 的普通字段编辑入口

#### Scenario: 详情页切换活跃与状态

- **WHEN** 用户在详情页点击“设为活跃”或变更核心 status
- **THEN** 对应接口被调用，页面反映最新的活跃标识与状态

### Requirement: 看板页面的创建删除与冲突提示

页面 SHALL 提供创建线程入口：要求填写标题，并允许填写核心 goal 字段的目标描述；目标输入 SHALL 提供安全 Markdown Live Preview，创建前 MUST NOT 自动保存。创建成功后可跳转到新线程详情。页面 SHALL 提供删除线程入口：删除前需确认；删除当前活跃线程时需二次明确确认。任何写操作收到 409 时，页面 SHALL 明确提示、保留本地草稿并提供冲突处理入口，MUST NOT 静默覆盖。

#### Scenario: 创建线程入口

- **WHEN** 用户在页面发起创建并填写标题
- **THEN** 新线程被创建，页面展示新线程

#### Scenario: 创建时填写目标描述

- **WHEN** 用户在创建对话框中填写标题与目标描述后创建
- **THEN** 创建前仅更新目标预览，创建请求携带标题与目标描述，新卷宗核心 goal 字段包含所填内容

#### Scenario: 删除活跃线程的二次确认

- **WHEN** 用户删除的线程是当前活跃线程
- **THEN** 页面在普通确认之外给出第二次明确确认，用户确认后才执行删除

#### Scenario: 写冲突提示

- **WHEN** 保存编辑时接口返回 409
- **THEN** 页面提示文件已被修改、保留本地草稿并提供冲突处理入口，不发生静默覆盖

### Requirement: 可见页面自动读取外部变更

页面 SHALL 在可见时定期检查当前项目 schema、线程详情、已打开便签和线程列表的外部变更，并在重新可见或获得焦点时立即检查。指纹与有效 schema 未变化时 MUST NOT 重置编辑或滚动状态；页面隐藏时 SHALL 暂停检查。本地无未保存修改时 SHALL 自动采用已变化的外部版本；schema 变化 SHALL 更新字段投影和可用视图，当前视图失效时按表格回退规则处理。

#### Scenario: 干净页面采用外部变更

- **WHEN** 当前文档没有未保存修改，Agent、文本编辑器或其他窗口改变其内容
- **THEN** 页面在后续检查中显示外部新版本并更新指纹，无需手动刷新

#### Scenario: 外部变更未影响当前小节

- **WHEN** 用户正在编辑某字段，外部仅修改该卷宗的其他字段
- **THEN** 页面保留当前草稿，采用外部其他字段和最新指纹，当前编辑可继续保存

#### Scenario: 外部修改 schema

- **WHEN** 页面可见且项目 schema 的字段、选项、字段顺序或视图配置被外部修改
- **THEN** 后续检查采用新 schema 更新表格与视图，不用旧字段配置继续写回

#### Scenario: 隐藏页面暂停检查

- **WHEN** 页面处于隐藏状态
- **THEN** 外部变更轮询暂停；页面重新可见或获得焦点时立即检查并采用符合冲突规则的版本
