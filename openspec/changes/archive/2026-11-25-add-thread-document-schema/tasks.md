# Tasks

## 1. Schema 与字段类型基础

- [x] 1.1 新增 schema 加载、默认配置与校验模块，落实六个核心字段、固定类型、status 四态、自定义字段和重复/非法配置错误；用单元测试覆盖缺文件回退、合法自定义字段及各类非法 schema。
- [x] 1.2 新增 markdown/select/reference 类型适配器及 parse/validate/serialize/summarize 纯函数；用单元测试覆盖 Markdown 注释摘要、必填与可选单选、引用去重保序/悬空/非法行，并验证 Changes 不进入引用解析。
- [x] 1.3 将新增 schema 与类型模块加入运行时 import 检查和发布白名单，执行对应 release 测试确认三宿主包均包含新模块。

## 2. 文档生成、解析与写回

- [x] 2.1 用 schema 生成器替换默认模板创建路径，生成核心字段、顺序、默认值、key 标记、字段说明和选项注释；更新初始化与创建测试，验证新项目不再创建模板且默认卷宗保留旧结构语义。
- [x] 2.2 实现 key 标记、当前 label、核心旧默认 label 的三级匹配及未映射小节投影；用旧卷宗 fixture 验证字段改名、缺字段、schema 外内容、旧模板注释、重复/歧义标记和只读零写入。
- [x] 2.3 实现按字段 key 的局部更新与缺失字段末尾补建，统一 select/reference 校验和序列化；用测试验证其他字段与未映射原文不变、409、BOM/CRLF、原子写盘和 P4 checkout/只读重试。
- [x] 2.4 将旧 section/status 写入口适配到通用字段实现，执行既有 threads、deps、regression、BOM、VCS 测试，确认旧默认 label 与四态调用保持兼容。

## 3. 服务投影与接口

- [x] 3.1 扩展列表和详情投影，返回有效 schema、schemaFingerprint、按 key 组织的字段值、详情原始净内容、未映射小节和行级文件指纹，同时保留旧 status/goalExcerpt/deps/sections；用接口测试覆盖默认与自定义 schema。
- [x] 3.2 新增 `PUT /api/thread/field` 并接入现有错误映射、注册状态守卫、同源 JSON 校验、活动续期和 P4 写路径；用服务端测试覆盖 markdown content、select/reference value、非法 key/值、409 和缺字段补建。
- [x] 3.3 验证 schema 缺失与非法的错误分支及旧服务协议兼容；运行 server/gating/protocol 测试，确认保留旧接口时 `protocolVersion` 仍为 1。

## 4. 全字段表格与详情编辑

- [x] 4.1 将 App 和列表轮询改为消费有效 schema 与字段投影，建立 `{kind, fieldKey}` 视图状态和 schema 指纹比较；用前端测试验证自定义列、无变化不重置、外部 schema 更新及失效视图回退表格。
- [x] 4.2 实现表格字段单元格：Markdown 摘要与行内展开 Live Preview、select 选项编辑、reference 增删/跳转/悬空标记；用组件与同步测试覆盖自动保存、连续输入、三方合并、409 草稿保留和仅目标字段写回。
- [x] 4.3 将详情页改为按 schema 渲染和编辑字段，保留核心 goal 随手编辑、其他字段解锁、活跃/状态操作，并以只读区域展示未映射小节；用详情和外部同步测试验证旧模板注释与自定义字段行为。
- [x] 4.4 调整创建入口按核心 goal 写入目标描述并适配新初始化文件列表；运行创建、P4 新文件询问和冲突提示测试，确认便签与项目注册行为不变。

## 5. 类型化看板与线程引用图

- [x] 5.1 将看板改为接收任意 select 字段的 key、options 和字段值，拖拽与单元格共用通用更新；用测试验证自定义 select 分组、非法/失效字段回退和默认 status 看板回归。
- [x] 5.2 将依赖图泛化为任意 reference 字段的线程引用图，建边、删边和节点跳转均使用所选字段；用图模型与交互测试验证非核心引用隔离、自引用、成环和悬空节点。
- [x] 5.3 将图节点位置键改为项目根 + 字段 key + 线程标识，并移除固定未完成视图；用 web 测试验证多图位置隔离、默认三个视图入口和无通用筛选。

## 6. Agent 约定与人工文档

- [x] 6.1 更新 `viewer/SYSTEM.md`，按核心 key 描述校准、拐点捕获、引用展开与归档蒸馏，并静态写入三类字段通用约束；运行 hooks/release 测试并验证三宿主分发正文一致且不超过 10000 字符，不出现运行时提示接口要求。
- [x] 6.2 更新 `viewer/skills/kanban-compress/SKILL.md` 与 `openspec/config.yaml` 的相关指引，使其按核心 key 定位 Changes、completed 和 decisions；检查文档中的旧固定小节描述已全部消除且默认 label 示例仍可用。
- [x] 6.3 更新 `kanban/README.md`，说明 schema 配置、三类字段、程序创建、旧模板停用、旧卷宗不自动迁移及纯文本操作；按文档步骤在临时项目手工创建和编辑默认/自定义字段，验证步骤可执行。

## 7. 集成验收

- [x] 7.1 执行 `npm test --prefix viewer` 全量测试，修复本变更导致的回归并确认无新增测试产物遗留在仓库。
- [x] 7.2 通过真实本地服务和桌面内置浏览器完成默认及自定义 schema 的端到端验收：初始化、创建、三类单元格编辑、详情、通用看板、引用图、外部 schema/文件变更与 409 冲突，核对磁盘仅目标字段变化。
- [x] 7.3 使用临时输出目录执行三宿主 release stage/verify，确认新模块、更新文档和静态资源完整；清理临时目录并检查 `git status` 仅包含本变更预期文件。

## 8. 视图入口配置化

- [x] 8.1 扩展默认 schema、加载与校验：显式定义默认三视图，支持有序 `views` 及 table/board/graph 字段绑定校验；既有 schema 省略 `views` 时仅在有效配置中补默认值且不回写，非法视图配置明确定位并报错，schema 指纹覆盖视图变化；补充默认、缺省、合法自定义及各类非法视图测试。
- [x] 8.2 将前端入口生成改为消费有效 `schema.views`，按配置 label 和顺序展示，不再为每个 select/reference 自动派生入口；视图有效性同时核对配置项及字段绑定，失效时回退配置的 table，当前选择仍不写入 schema、URL 或 localStorage；用 web 测试覆盖重命名、重排、不自动派生、外部视图变更和刷新回表格。
- [x] 8.3 将本项目 `kanban/thread.schema.json` 的默认三视图显式物化，并更新 `kanban/README.md` 的视图配置说明与示例；验证旧 schema 无需手工迁移、新配置可直接通过文本编辑器维护。
- [x] 8.4 执行视图/schema 相关测试及 `npm test --prefix viewer` 全量回归，并通过真实本地服务和桌面内置浏览器验收默认三视图、自定义名称与顺序、自定义字段不自动产生入口、非法绑定报错、旧 schema 缺省兼容及外部修改后的表格回退；确认当前选择未持久化且无测试产物遗留。
