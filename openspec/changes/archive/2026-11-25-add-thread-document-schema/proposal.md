# Proposal

## Why

当前线程文档的模板、必备小节、状态选项、引用解析和前端视图分别硬编码在服务端、页面与 Agent 约定中，无法在不修改程序的情况下调整线程结构。需要以项目级 schema 统一描述字段，同时保留纯 Markdown 文件、旧文档数据和核心线程工作流。

## What Changes

- 新增项目级 `kanban/thread.schema.json`，以“核心字段 + 自定义字段 + 有序视图清单”描述线程结构与展示入口；核心字段使用稳定 key，自定义字段可按受支持类型扩展。
- 以程序化文档生成取代新线程对 `kanban/templates/thread.md` 的依赖；默认 schema 完整承载旧模板的字段、说明、状态选项和依赖语义。
- 提供 `markdown`、`select`、`reference` 三类字段；`reference` 仅表示线程引用，`Changes` 保持普通 Markdown 字段。
- 创建线程时把 schema 字段说明和实例配置生成到对应小节注释；类型的通用约束静态维护在 `SYSTEM.md`，不引入运行时提示拼装接口。
- 服务端按当前 schema 解析、校验、投影和更新字段，保留整文件指纹、原子写盘、冲突处理和 P4 约束；schema 与旧文档不一致时保留原文并显式标记，不自动迁移整份文档。
- 前端重构为以全字段表格为本体，支持各类型单元格编辑；`table`、`board`、`graph` 作为三种内置渲染能力，视图入口、名称、顺序及字段绑定由 `schema.views` 显式配置，不再按字段类型自动派生入口，并保留 schema 驱动的详情页。
- 移除固定“未完成”筛选视图；本变更不提供通用筛选、schema 图形化编辑界面或自定义视图插件。当前视图选择仅保留在页面状态中，不持久化用户最后选择的视图。
- 同步更新 Agent 常驻约定、压缩与归档相关指引、人工操作文档、发布文件清单和测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `kanban-threads`: 线程卷宗从固定模板与固定必备小节改为 schema 驱动，并定义核心字段、自定义字段、默认 schema、旧文档兼容和 Agent 提示来源。
- `kanban-viewer`: 初始化、线程创建、查询与字段更新改为 schema 驱动，页面按 `schema.views` 提供经过校验的有序视图入口，并由内置表格、看板和线程引用图渲染器消费字段绑定。

## Impact

- 影响 `viewer/server/threads.mjs`、服务 API、前端列表/详情/看板/依赖图及文档同步逻辑，并新增 schema 与字段类型相关模块。
- 保留 `thread.md` 为线程内容载体；新项目不再创建模板文件，已有模板文件不删除但不再作为创建依据。
- 优先以兼容适配保留既有 section/status 接口和列表字段；仅在实际协议兼容性无法维持时才递增 `protocolVersion`。
- 影响 `viewer/SYSTEM.md`、`viewer/skills/kanban-compress/SKILL.md`、`kanban/README.md`、相关 OpenSpec 规格、测试与 `scripts/release.mjs` 白名单。
- 不新增第三方依赖，不改变全局便签、项目注册、服务生命周期和活跃线程指针的既有语义。
