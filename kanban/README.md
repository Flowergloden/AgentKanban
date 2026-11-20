# 线程看板（kanban/）操作手册

`kanban/` 用纯 Markdown 和 JSON 文件承载跨会话目标（称为**线程**）。只用文本编辑器即可完成全部操作。OpenSpec change 是可选关联，不是必经路径。

## 目录结构

```text
kanban/
├── current                 # 活跃线程目录名；空或不存在 = 无活跃线程
├── note.md                 # 人类专属便签，Agent 不读取、不采用
├── thread.schema.json      # 项目级有序字段结构
├── threads/<id>-<slug>/thread.md
└── README.md
```

旧项目可能仍有 `kanban/templates/thread.md`。它会被原样保留，但新版创建线程不再读取或补建模板，而是由程序按当前 schema 生成卷宗。

## Schema 与核心字段

`thread.schema.json` 的 `version` 当前为 1，`fields` 是有序数组。每项包含稳定 `key`、显示 `label`、`type`、`description`，以及可选的 `required`、`default`；`select` 还必须配置非空且不重复的 `options`。key 使用小写英文 kebab-case，key 与 label 均不得重复。

六个核心字段必须各出现一次且类型固定：

| key | 默认 label | 类型 | 用途 |
|---|---|---|---|
| `status` | `status` | select | 固定四态：立项、规划、实现、完成；默认立项 |
| `goal` | `目标` | markdown | 线程目标 |
| `completed` | `已完成的工作` | markdown | 进展与归档蒸馏 |
| `decisions` | `决策` | markdown | 决定及其原因 |
| `changes` | `Changes` | markdown | 可选 OpenSpec change 名称列表 |
| `dependencies` | `依赖` | reference | 可选核心线程依赖 |

label、description 和字段顺序可改，核心 key 与类型不可改。`title` 是卷宗 H1 系统元数据，不是 schema 字段。schema 缺失时读取使用内置默认结构；文件存在但非法时会报错，不能靠删除核心字段或改成未知类型来绕过。

### 三类字段

- **markdown**：任意 Markdown 原文。字段说明放在 HTML 注释中，不算正式内容。`changes` 只是名称列表，不产生线程引用。
- **select**：只能取 `options` 中一个值；非必填字段可空。页面提供选项控件及按选项分组的看板。
- **reference**：只保存四位线程序号，一行一条 `- 0002`，有序去重；可指向不存在序号并显示悬空标记。页面提供增删、跳转及引用图。核心 `dependencies` 不约束状态，自定义 reference 也不会自动获得依赖工作流含义。

## 创建与生成格式

推荐通过看板页面“新建线程”或创建接口生成：程序分配序号与 slug，写入标题、核心 status 默认值、字段说明、select 选项注释和稳定 key 标记，并可把目标描述写入核心 `goal`。slug 留空时使用 `unnamed-pending` 占位，由 Agent 在活跃线程校准时命名；该保留字不可显式使用。

纯文本创建时，在 `kanban/threads/` 新建 `<NNNN>-<slug>/thread.md`，按 schema 顺序写出字段。例如默认核心目标字段：

```markdown
# 用户认证

status: 立项

## 目标

<!-- kanban:field=goal -->
<!-- 这条线程要达成的目标。 -->

打通登录与注册
```

其余 H2 字段同样使用 `## <label>` 和 `<!-- kanban:field=<key> -->`。`status` 只有前缀行，不建 H2。新文档的标记使 label 后续改名仍不影响识别；旧文档没有标记时依次按当前 label 和核心旧默认 label 识别。重复、冲突或未知标记不会由服务猜测写入。

schema 新增字段时，旧卷宗读取为空值，保存该字段才会在文档末尾补建；schema 移除字段后，原小节作为未映射内容只读保留。修改 description、选项或顺序不会自动迁移、刷新注释或重排旧卷宗。

## 日常操作

### 激活线程

把线程目录名写入 `kanban/current`，例如 `0002-user-auth`；清空即无活跃线程。同一时刻最多一条。

### 记录进展与决策

按核心 key 找到字段（默认 label 如下）并直接追加：

- `completed` / `## 已完成的工作`：一条含日期与概要的进展。
- `decisions` / `## 决策`：每条必须同时含决定和原因：

```markdown
- **决定**：……
  **原因**：……
```

### 流转状态

修改 `status: 立项` 行为立项、规划、实现、完成之一。状态由人判断，不从 change 或引用关系自动推导。

### 关联 change（可选）

在核心 `changes`（默认 `## Changes`）中一行一个名字，例如 `- add-user-auth`。归档属于线程的 change 后，Agent 将摘要追加到核心 `completed`。

### 维护线程引用（可选）

在核心 `dependencies`（默认 `## 依赖`）或其他 reference 字段中一行一个四位序号：

```markdown
- 0002
```

不要写目录名、slug、注解或原因。重命名 slug 不影响序号；目标删除后成为悬空引用，不做级联删除。缺字段视为空列表，需要时可手动补建或由页面保存时补建。

### 压缩卷宗（可选）

明确要求 Agent“压缩当前线程”或“精简卷宗”才会触发 `kanban-compress`。它按核心 key 整理 completed/decisions 等内容，保留目标、有效决策、未决事项、key 标记、引用和未映射小节，不读取或修改全局便签。

## Agent 侧约定（摘要）

插件 `SYSTEM.md` 注入完整约定：会话开始读取活跃卷宗并按核心 key 校准；出现方向否决、验证结论、目标决策、搁置或重启时询问是否记录；归档关联 change 后蒸馏到 completed。三类字段的通用约束静态写在同一文件中，不需要运行时提示接口。
