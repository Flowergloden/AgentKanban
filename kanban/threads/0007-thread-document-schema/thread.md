# 线程文档 shema

status: 实现

<!-- 状态可选值：立项、规划、实现、完成。流转方式：直接修改上一行的 status 值。 -->

## 目标

将线程文档的结构配置化，不再定死为此前的 template

## 已完成的工作

<!-- 每完成一段工作，在此追加一条记录（含日期与概要），小需求一句话即可，无需关联 change。若使用 OpenSpec：属于本线程的 change 归档后，其蒸馏总结也追加在这里。 -->

- 2026-11-25 归档 change `add-thread-document-schema`（主规格已同步）：
  - 动机：线程文档的模板、必备小节、状态选项、引用解析与前端视图分别硬编码在服务端、页面与 Agent 约定中，无法在不修改程序的情况下调整线程结构。
  - 关键决定：以项目级 `kanban/thread.schema.json` 统一描述核心字段、自定义字段与有序视图清单，核心语义由程序注册表持有；字段分 markdown/select/reference 三类，`Changes` 保持普通 Markdown；新卷宗由程序按 schema 生成（稳定 key 标记 + 字段说明注释），模板文件退出创建路径；旧卷宗经 key 标记 → 当前 label → 旧默认 label 三级匹配兼容，不自动迁移；视图入口由 `schema.views` 显式配置，移除固定"未完成"视图，旧 section/status 接口保留适配。
  - 完成情况：27/27 任务完成；`kanban-threads` 与 `kanban-viewer` 主规格已合并（新增 5 个需求、修改 15 个需求）；`npm test --prefix viewer` 全量测试与三宿主 release stage/verify 通过。

## 决策

<!-- 每条决策 MUST 同时包含"决定了什么"与"为什么"，格式：
- **决定**：……
  **原因**：……
-->

## Changes

<!-- （可选）关联的 OpenSpec change 名字列表，仅当本线程使用 OpenSpec 工作流时才登记；不使用时留空即可。一行一条（仅名字，松耦合引用），例如：
- add-xxx
-->
- add-thread-document-schema

## 依赖

<!-- （可选）本线程依赖的其他线程：纯序号、一行一条，仅记录关系，不约束状态流转或完成。 -->
- 0002
