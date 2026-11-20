# Design

## Context

现有实现由 `viewer/server/threads.mjs` 同时承担模板、固定字段校验、Markdown 切片、类型解析和文件写入；前端分别用固定列、固定小节和固定视图消费专用响应字段。`SYSTEM.md` 与压缩/归档指引也按中文小节名定位工作流字段。项目使用 Node 原生模块和 vendored Preact，无构建步骤、无第三方运行时依赖；所有写入还须保留文件指纹、BOM/EOL、原子写入和 P4 门控。

## Goals / Non-Goals

**Goals:**

- 用一个项目级 JSON schema 驱动创建、解析、校验、API 投影、表格列和显式配置的视图入口。
- 用稳定字段 key 解耦核心工作流与可修改的显示 label。
- 保留 Markdown 原文与旧卷宗，不以全量迁移换取结构一致。
- 复用现有 Live Preview、文档同步、冲突合并、依赖图和 P4 写盘能力。
- 以静态 `SYSTEM.md` 类型约束和创建时生成的字段注释向 Agent 提供规则。

**Non-Goals:**

- 不引入数据库、JSON 线程存储或运行时提示拼装服务。
- 不支持 schema 图形化编辑、通用筛选、当前视图选择持久化或自定义视图插件；视图清单本身由项目 schema 显式配置。
- 不支持 reference 指向 OpenSpec change、文件或 URL；Changes 保持 Markdown。
- 不允许修改核心字段 key 或类型，核心 status 固定为“立项、规划、实现、完成”四态。
- 不自动刷新旧卷宗中的说明注释，不重排既有字段。

## Decisions

### 1. Schema 描述字段与视图，核心语义由程序注册表持有

新增 `kanban/thread.schema.json`，采用带版本的有序字段列表和有序视图清单：

```json
{
  "version": 1,
  "fields": [
    {
      "key": "status",
      "label": "status",
      "type": "select",
      "description": "线程生命周期。",
      "options": ["立项", "规划", "实现", "完成"],
      "default": "立项",
      "required": true
    },
    {
      "key": "goal",
      "label": "目标",
      "type": "markdown",
      "description": "这条线程要达成的笼统目标。",
      "required": true
    }
  ],
  "views": [
    { "key": "all", "label": "全部字段", "kind": "table" },
    { "key": "status-board", "label": "状态看板", "kind": "board", "fieldKey": "status" },
    { "key": "dependency-graph", "label": "依赖关系", "kind": "graph", "fieldKey": "dependencies" }
  ]
}
```

默认 schema 在程序中完整定义六个核心字段及“全部字段、核心 status 看板、核心 dependencies 引用图”三个显式视图，初始化时物化为项目文件。核心字段及固定类型为：

- `status`: select，固定四态和默认值“立项”。
- `goal`、`completed`、`decisions`、`changes`: markdown。
- `dependencies`: reference。

核心字段不可缺失或改类型；label、description 和字段顺序可配置。自定义字段可使用三种类型，select 必须具有非空且不重复的 options，reference 不需要 target 配置。key 使用受限的小写英文 kebab-case，key 与文档映射 label 均须唯一。`title` 保持系统元数据，不作为可配置字段；`status` 是唯一存放在 H2 小节之外的 schema 字段。

`views` 是非空有序数组，每项具有稳定 key、显示 label 和 `table`、`board`、`graph` 之一。视图 key 使用小写英文 kebab-case 且不得重复，label 必须是非空单行字符串。清单必须且只能包含一个不携带 `fieldKey` 的 table；board 和 graph 必须分别绑定存在的 select 和 reference 字段，非 table 视图的 `kind + fieldKey` 组合不得重复。字段存在于 `fields` 不会自动产生视图，入口名称、顺序与绑定只以 `views` 为准。

既有 schema 省略 `views` 时，读取结果补入默认三视图且不写回项目文件，以兼容本变更前已生成的配置；`views` 一旦存在就必须通过上述校验，不能用默认视图掩盖非法配置。新初始化和补齐默认 schema 时显式物化 `views`。schema 文件缺失与文件非法必须区分：前者使用默认配置，后者返回带路径和字段定位的错误并阻止相关写操作。初版每次列表/详情读取重新加载 schema，避免缓存失效复杂度；响应携带包含视图配置的 schema 内容指纹供前端轮询比较。

### 2. 类型适配器负责值与 Markdown 表示之间的转换

服务端新增独立的 schema 与字段类型模块，将现有固定逻辑拆成纯函数：

```text
parse(raw, field)       -> typed value
validate(value, field)  -> normalized value or field error
serialize(value, field) -> raw field content
summarize(value, field) -> table display projection
```

类型行为：

- markdown：值为原始 Markdown；摘要时排除 HTML 注释、折叠空白并截断，编辑仍使用原始净内容。
- select：值为单个字符串；空值仅在该字段非必填时允许；序列化为单行选项。
- reference：值为有序去重的四位线程序号数组；序列化为一行一条 `- NNNN`；忽略注释和非法行，不将悬空引用视为解析错误。

`SYSTEM.md` 静态描述这些通用约束，字段说明和 select options 由生成器写入卷宗注释。类型模块不提供 `agentConstraint`，服务也不返回拼装提示。新增类型时必须同批更新 `SYSTEM.md`、编辑器和视图能力。

### 3. 稳定 key 标记与三级旧文档匹配避免字段改名丢数据

新卷宗的每个 H2 字段生成独立标记和说明，例如：

```markdown
## 目标

<!-- kanban:field=goal -->
<!-- 创建时填写：这条线程要达成的笼统目标。 -->
```

status 继续使用 `status: 立项`，其 key 由核心字段身份确定。H2 字段按以下顺序匹配：

1. 明确且唯一的 `kanban:field=<key>` 标记；
2. 当前 schema 的唯一 label；
3. 核心字段的内置旧默认 label。

冲突标记、重复 label 或一个标记指向未配置 key 时，不猜测写入目标；原小节可作为未映射内容读取，目标写操作返回明确错误。未配置小节始终保留在解析结果的独立区域。

只有创建和“保存当前 schema 中但卷宗缺失的字段”会生成新结构。后者为最小化 diff，统一在文档末尾补建 label、key 标记、说明和值，不移动既有小节；前端展示顺序始终由 schema 决定。普通字段更新沿用局部替换，并保留原文件 BOM、EOL、其他字段、注释和未映射内容。

旧模板说明注释不参与摘要、select/reference 解析或单元格展示；Markdown 原始净内容仍在详情编辑通道中保留，只有用户明确保存该字段时才可能改写目标字段内的旧注释。

### 4. API 增加字段投影和通用写入口，旧协议保留适配

列表响应增加：

```text
schema, schemaFingerprint
threads[].fingerprint
threads[].fields[key] = typed value
```

详情响应增加 `fields[key] = { value, content }` 和 `unmappedSections[]`。现有 `status`、`goalExcerpt`、`deps` 与 `sections` 由核心字段和默认/当前 label 适配生成，供旧页面或外部调用方继续使用。

新增 `PUT /api/thread/field`：

- markdown 请求使用 `content`，保留 Live Preview 与三方合并的原文通道。
- select/reference 请求使用 `value`，由服务端校验并序列化。
- 所有请求携带整文件 `fingerprint`，响应返回新指纹。

旧 `PUT /api/thread/section` 和 `POST /api/thread/status` 转入同一字段更新实现。旧 section 名按当前 label 或核心旧默认 label 解析；歧义时拒绝写入。由于响应和接口以新增为主且保留旧行为，`protocolVersion` 保持 1；若实现验证发现无法维持旧契约，再停止并重新评估协议版本，而非静默破坏兼容。

### 5. 前端统一为字段模型，视图清单由配置驱动

`App` 的视图状态保持轻量的能力绑定：

```text
{ kind: 'table' }
{ kind: 'board', fieldKey }
{ kind: 'graph', fieldKey }
```

但状态只能由 `schema.views` 中已配置的入口产生，不能再遍历字段类型自动创建入口。有效 schema 与线程字段值共同驱动渲染：

- 表格入口来自唯一的 table 配置，展示固定系统列加 schema 字段列；每行携带文件指纹。
- 只有配置为 board 的 select 字段才显示看板入口；入口 label 与顺序来自视图配置，看板列来自绑定字段的 options，拖拽与单元格编辑共用字段写入口。
- 只有配置为 graph 的 reference 字段才显示引用图入口；引用图接收绑定的 `fieldKey`，不再读取固定 `deps` 或写死“依赖”小节。
- markdown 单元格默认显示摘要，点击后在当前行展开 Live Preview；继续复用 `createDocumentSync`、外部版本协调与三方合并。
- 详情页按 schema 渲染全部字段；核心 goal 随手编辑，其余字段显式解锁；未映射小节只读展示。
- 视图选择只保留在页面状态中，不写入 schema、URL 或 localStorage。schema 轮询发现当前入口被移除、kind/fieldKey 改变或绑定字段失效时，回退到配置的 table 并提示，不发送基于旧配置的写请求；仅 label 或其他入口顺序变化不重置当前有效视图。

非 table 视图的 `kind + fieldKey` 唯一，因此上述状态可无歧义地匹配一个配置入口。依赖图的位置存储键继续使用字段 key，避免不同引用字段的图互相覆盖位置。节点仍使用核心 status 着色，核心 goal 仅用于卡片摘要，Changes 不参与图或线程链接。

### 6. Agent 工作流按 key 定位，提示保持纯文件可读

`SYSTEM.md` 继续承载四条常驻约定，并补充三类字段的静态通用约束。会话校准、拐点捕获和归档蒸馏按核心 key 找到当前文档字段；默认 label 仅作为旧卷宗回退匹配。Agent 直接阅读卷宗中创建时生成的说明和选项，无需服务提供提示。

`kanban-compress` 与项目 `openspec/config.yaml` 中相关指引同步改为核心 key 语义。`kanban/README.md` 说明手工维护 schema 和三类字段。新增运行时模块加入 `scripts/release.mjs` 白名单，SYSTEM 继续受 10000 字符校验约束。

## Risks / Trade-offs

- [字段说明注释会随 schema 修改而过时] → 这是已接受的复杂度取舍；当前 schema 始终控制校验和 UI，新卷宗获得新说明，不自动改写旧文件。
- [旧文档 label 与自定义 schema 映射可能歧义] → 新文档使用 key 标记，旧核心字段保留旧 label 回退；重复或未知标记宁可只读报错，不猜测写入。
- [过滤 HTML 注释可能让 Markdown 摘要遗漏有意内容] → 仅摘要做过滤，原始编辑内容不丢失；用户可在详情源码/Live Preview 中查看原文。
- [schema 外部变化与正在查看或编辑的页面竞争] → 轮询同时比较 schema 与文件指纹；当前视图配置失效时回退表格，正在编辑的字段失效时停止该字段写入，文件冲突仍走 409 和草稿保留。
- [长 Markdown 全字段表格可能过宽或过重] → 列表只返回摘要所需投影，详情/编辑按需读取原始内容；单元格展开而非持续渲染全部编辑器。
- [保留旧 API 增加适配复杂度] → 适配层只做名称与响应投影转换，实际校验和写盘只有一套字段实现，并以旧测试作为兼容回归。
- [新增文件容易漏入三宿主发布包] → 将白名单与运行时 import 校验列为实施任务，并执行三宿主 stage/verify。

## Migration Plan

1. 新版服务在既有项目需要补齐结构时仅新增默认 `thread.schema.json`，其中显式包含三个默认视图；不删除模板、不修改卷宗。
2. 既有自定义 schema 缺少 `views` 时只在有效配置中补默认三视图，不回写文件；旧卷宗通过 label 回退匹配立即进入新表格，新增字段显示为空，未映射内容只读保留。
3. 新建卷宗带 key 标记和字段说明；之后修改 label 不需要迁移。项目可手工增加或调整 `views`，无需迁移卷宗正文。
4. 回滚到旧版时，默认 schema 生成的卷宗仍有原 H1、status 和核心 H2 小节，旧解析器可继续读取；新增 schema 文件、自定义小节和视图配置保持为普通文件内容，不执行逆向批量迁移。
5. 完成服务端、前端、Agent 文档和发布包验证后再发版，发版只走既有 `scripts/publish.mjs` 流程。
