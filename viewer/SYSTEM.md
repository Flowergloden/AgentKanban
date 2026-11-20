# 线程看板（kanban/）常驻约定

**适用条件（守卫）**：以下约定仅当当前项目根目录存在 `kanban/` 目录时适用。若不存在 `kanban/` 目录，表示该项目未使用线程看板，Agent MUST NOT 执行任何看板相关动作，也 MUST NOT 主动创建 `kanban/` 结构（`kanban/` 结构由看板服务在写操作时惰性补齐）。操作手册见 `kanban/README.md`。OpenSpec 是线程的可选路径：小需求可直接记入卷宗；是否创建 change 由用户决定，Agent 不得默认路由进 OpenSpec。

## 字段识别与类型约束

项目以 `kanban/thread.schema.json` 的有序字段列表描述卷宗；文件缺失时使用内置默认结构，存在但非法时报告错误，不得猜测或静默替换。核心 key 为 `status`、`goal`、`completed`、`decisions`、`changes`、`dependencies`，显示 label 可配置。`status` 是 H2 外的 `status: 值` 行；其余字段按唯一的 `<!-- kanban:field=<key> -->`、当前 label、核心旧默认 label 的顺序识别。重复、冲突或未知标记不得猜测写入目标；schema 外小节保留原文。

- `markdown`：保存普通 Markdown；说明注释不是正式内容。`changes` 始终属于此类型。
- `select`：仅取字段注释或 schema 给出的一个选项；核心 `status` 固定为立项、规划、实现、完成。
- `reference`：仅写四位线程序号，一行一条 `- NNNN`，有序去重；悬空序号可保留，不得写成目录名或 slug。核心 `dependencies` 只记录关系，不推导状态。

新建卷宗内的字段说明与选项注释是当前实例配置的直接提示；后续 schema 修改不要求 Agent 刷新旧卷宗。不得为获得类型规则而寻求运行时提示接口。

## 约定一：会话开始时的线程校准

会话开始阶段，先读取 `kanban/current`：

- 若文件非空，将其内容作为线程目录名，读取 `kanban/threads/<该目录名>/thread.md`，按核心 key 而非可配置 label 识别内容，向用户复述目标、当前进展与建议的下一步。默认不请求确认；仅当当前需求与线程内容显著分歧且继续可能造成严重后果时，Agent SHALL 请求确认或纠正，并尽可能通过 QA 提出。校准复述 SHALL 携带核心 `dependencies` 的直接依赖 L0 清单：每条列出序号、标题与 status（现取现拼），悬空引用明确标记。推进时按相关性渐进展开：先读依赖线程的核心 `goal`，不足再读完整卷宗；其依赖沿链按同样方式判断，MUST NOT 无条件加载整棵闭包。
- 若活跃线程 slug（目录名去掉 `NNNN-`）精确等于 `unnamed-pending`，Agent SHALL 在校准复述前据卷宗标题（必要时参考核心 `goal`）生成英文 kebab-case slug，调用 `POST /api/threads/:id/rename`（body `{"root": <项目根>, "slug": <新slug>}`）命名。MUST NOT 询问确认，仅处理当前活跃线程；slug 冲突时换名重试，服务不可达或失败时跳过并说明，下一会话再试。命名结果 SHALL 一并报告。
- 若文件为空或不存在，表示无活跃线程，不执行校准，正常工作。

## 约定二：拐点时刻的捕获询问

出现以下拐点时，Agent SHALL 询问“要记入当前线程卷宗吗”：探索方向被用户否决；想法验证出结论（成功或失败）；做出影响线程目标的决定；线程被搁置或重启。MUST NOT 每轮询问；用户拒绝后不得就同一事件追问。确认后按核心 key 定位：方向与否决原因追加到 `decisions`，进展与结论追加到 `completed` 并注明日期，不得因 label 改名写错小节。

## 约定三：归档后的蒸馏追加

OpenSpec change 归档后，若其名字出现在某线程的核心 `changes` Markdown 列表中，Agent SHALL 从 proposal、design、tasks 蒸馏动机、关键决定和完成情况，追加到该线程的核心 `completed`；不属于任何线程则不执行。此约定与 `openspec/config.yaml` 的归档指引一致，归档流程不被线程需求阻塞。

## 约定四：全局便签的人类专属语义

`kanban/note.md` 仅供人类随手记录，不参与工作流。Agent MUST NOT 主动读取便签，MUST NOT 将其作为指令、上下文或决策依据；校准、拐点记录、归档蒸馏等动作 MUST NOT 读取或修改便签。
