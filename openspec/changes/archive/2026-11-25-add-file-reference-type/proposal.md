# Proposal

## Why

Schema 驱动的线程卷宗目前只能记录自由 Markdown、单选项和线程引用，缺少供 Agent 与用户稳定定位项目文件的类型化入口。需要以可移植的项目相对路径记录文件，并通过系统文件选择器和受控只读预览减少手工录入与查阅成本，同时阻止项目外路径和本地文件读取接口被滥用。

## What Changes

- 新增自定义 `file` 字段类型，值为有序、去重的项目相对路径列表，在卷宗中一行一条并使用 `/` 分隔；支持 `required`、路径数组 `default` 和既有卷宗缺字段时的空值投影，不向默认 schema 增加核心字段。
- 扩展 schema、字段解析/校验/序列化、表格与详情的类型分派；`file` 字段不参与 board 或 graph 视图，现有 `reference` 的线程跳转与引用图语义保持不变。
- 表格和详情通过 Windows 系统文件选择器添加一个或多个文件，选择器以项目根为初始目录；服务端校验实际路径，任一目标越出项目或无效时整批拒绝并列出错误路径，取消选择不改变字段。
- 合法选择结果转换为相对路径，与现有列表保序去重后仍通过既有字段更新接口保存，继续遵守文件指纹、409 冲突、原子写盘与 P4 约束；前端不提供手输路径的替代编辑入口。
- 新增按需只读预览：仅允许读取指定线程 `file` 字段中已登记的项目内普通文件，限制为最大 1 MiB 的有效 UTF-8 文本；`.md` / `.markdown` 复用安全 Markdown 渲染，其他文本按原文显示，缺失、目录、越界、超限或非法编码均给出明确错误。
- 同步 Agent 静态类型约束、人工操作文档、自动化与 Windows 手工验收，以及三宿主发布白名单；不新增第三方依赖，不因新增兼容接口而递增 `protocolVersion`。
- 本 change 的 delta 以 `add-thread-document-schema` 已完成实现及其规格为直接基线；实施和归档前 SHALL 先完成该前序 change 的归档，避免主规格回退为仅支持三种字段类型的旧定义。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `kanban-threads`: 线程 schema 新增 `file` 字段语义、项目相对路径格式、默认值和 Agent 使用约束，人工文档同步覆盖文件引用。
- `kanban-viewer`: 字段化表格与详情支持系统文件选择、越界整批拒绝、文件引用展示和受限只读预览，通用字段更新与本地服务安全边界相应扩展。

## Impact

- 影响 `viewer/server/field-types.mjs`、`viewer/server/schema.mjs`、线程字段投影与更新逻辑，并新增系统文件选择及受控文件读取的服务端能力和 API。
- 影响 `viewer/web/field-controls.js`、表格与详情类型分派、API 客户端、预览弹窗和样式；复用 `viewer/web/markdown-preview.js`，不复制 Markdown 渲染器。
- 系统选择器采用项目现有 Windows 支持范围内的 PowerShell + WinForms，无新增运行时依赖；选择期间需要防止 auto 服务因空闲退出。
- 影响 `viewer/SYSTEM.md`、`kanban/README.md`、`docs/manual-acceptance.md`、`viewer/test/*.test.mjs` 与 `scripts/release.mjs` 白名单。
- 保留 `thread.md` 为唯一字段内容载体，不读取或写入全局便签，不自动迁移既有卷宗，不支持系统默认程序打开、文件编辑、二进制预览或 Markdown 本地图片加载。
