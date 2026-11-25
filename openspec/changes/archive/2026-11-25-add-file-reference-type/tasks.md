# Tasks

## 1. 基线与字段模型

- [x] 1.1 确认 `add-thread-document-schema` 已归档且主规格包含 schema 驱动的字段模型；若未归档则暂停实施并请用户显式发起前序 archive，以 `openspec show kanban-threads --type spec` 和 `openspec show kanban-viewer --type spec` 验证基线不再只有固定三类型/固定小节。
- [x] 1.2 新增 `viewer/server/file-paths.mjs` 的相对路径规范化与项目包含关系检查，并在 `viewer/test/file-paths.test.mjs` 覆盖 Windows/POSIX/UNC、`.`/`..`、重复分隔符、中文、空格、NUL、目录式路径和符号链接越界，运行 `node --test viewer/test/file-paths.test.mjs` 验证。
- [x] 1.3 扩展 `viewer/server/field-types.mjs` 的 file 解析、校验、保序去重和列表序列化，保持非法旧原文只读保留而显式更新整批拒绝；在 `viewer/test/field-types.test.mjs` 覆盖合法/非法值、缺失目标、required 和既有类型回归，运行对应测试文件验证。
- [x] 1.4 扩展 `viewer/server/schema.mjs` 与 `viewer/server/thread-document.mjs`，支持 file 的 `default: []`、required、空值投影、创建/补建字段，并拒绝 file 绑定非表格视图；更新 `schema.test.mjs`、`thread-document.test.mjs`、`thread-schema-api.test.mjs`，验证默认 schema 不变、旧卷宗不改写、字段更新仍遵守 409 与 P4。
- [x] 1.5 在 `viewer/SYSTEM.md` 和 `kanban/README.md` 写入 file 的静态 Agent 约束、手工列表格式、默认值、越界与缺失文件语义，以文档中的自定义 file 配置示例走一次创建/读取/保存测试，并确认 SYSTEM 仍满足发布字符上限。

## 2. Windows 系统选择与生命周期

- [x] 2.1 新增 `viewer/server/file-picker.mjs`，以 PowerShell STA + WinForms 实现多选、项目根初始目录、UTF-8 JSON 输出、取消与进程错误分类；通过注入 runner/shim 在 `viewer/test/file-picker.test.mjs` 覆盖合法多选、取消、非零退出、异常 JSON、输出超限和中文路径，确保测试不弹真实窗口。
- [x] 2.2 新增 `viewer/server/file-references.mjs` 的选择编排及 `POST /api/thread/file-selection`，完成注册项目、同源 JSON、线程/file 字段门控、逐项实际路径校验和 422 `rejected` 聚合；在 API 测试中验证合法结果不落盘、混合选择整批拒绝、目录/缺失/越界链接、未注册与跨源请求不启动对话框。
- [x] 2.3 扩展 `viewer/server/lifecycle.mjs` 的成对活动租约并接入选择路由的 `finally` 释放，更新 `viewer/test/lifecycle.test.mjs` 和选择 API 测试，以可控时钟/延迟 shim 验证嵌套租约、异常释放、关闭后重新计时、超过原空闲期限仍不退出及 persistent 回归。
- [x] 2.4 在 `docs/manual-acceptance.md` 增加系统选择器专项步骤，覆盖初始目录、前台显示、多选、取消、混合越界提示、进程失败与长开对话框保活；执行可自动化的服务/API 测试并记录真实 Windows 验收待界面联调后完成。

## 3. 受控只读预览服务

- [x] 3.1 在 `viewer/server/file-paths.mjs` 增加基于 realpath 和文件句柄的普通文件复检、至多 1 MiB + 1 字节有界读取、严格 UTF-8 与 NUL 检查；扩展 `file-paths.test.mjs` 覆盖缺失、目录、越界链接、恰好 1 MiB、超限、非法 UTF-8、NUL 和中文文本并运行通过。
- [x] 3.2 在 `viewer/server/file-references.mjs` 与 `viewer/server/server.mjs` 实现 `GET /api/thread/file` 的字段成员资格校验、Markdown/text 分类、结构化错误和 `Cache-Control: no-store`；新增 `viewer/test/file-references.test.mjs` 或扩展服务 API 测试，验证未注册项目、未登记路径、字段不匹配和实际越界均不返回正文。
- [x] 3.3 在 `kanban/README.md` 补充按需预览的类型、大小、编码、缺失/目录错误和不可编辑边界，以 API 测试证明普通列表/详情读取不调用文件正文读取，并验证旧线程查询与字段更新回归测试通过。

## 4. 前端文件控件与预览

- [x] 4.1 在 `viewer/web/api.js` 和 `viewer/web/field-controls.js` 实现 `FileFieldControl` 的系统选择、保序去重、逐项移除、busy/dirty/error 与既有字段保存；扩展 `viewer/test/web.test.mjs` 等既有前端测试，验证取消/拒绝不改草稿、失败不伪报成功、409 保留选择结果及外部刷新不覆盖 dirty 草稿。
- [x] 4.2 修改 `viewer/web/views-table.js`、`viewer/web/detail.js` 为四种类型显式分派，增加 file 路径展示、编辑入口与样式，更新相关前端测试，验证 file 不再落入线程引用控件、无手输路径入口且 markdown/select/reference 行为不回归。
- [x] 4.3 实现只读文件预览模态框，按需获取 Markdown/text、区分预览与保存错误，并为文件 Markdown 增加不影响其他页面的禁止图片策略；扩展 `markdown.test.mjs` 与前端测试，覆盖恶意 HTML、Markdown/原始 HTML 图片无请求、清理失败回退、文本不执行 HTML及各加载/错误状态。
- [x] 4.4 完成表格到详情、选择到保存、预览到关闭的浏览器端联调，并更新 `docs/manual-acceptance.md` 的对应操作与预期；以真实项目内 Markdown/文本/缺失文件及一次 409 冲突验证完整交互，检查未操作预览时不产生正文请求。

## 5. 发布与整体验证

- [x] 5.1 将新增服务端和前端运行时文件加入 `scripts/release.mjs` 白名单并更新 `viewer/test/release.test.mjs`，运行该测试及当前版本的三宿主 stage/verify，确认 Kimi/Codex/Claude 包均包含新模块、SYSTEM 未超限且无多余文件。
- [x] 5.2 执行 `npm test --prefix viewer` 全量回归与 `openspec validate add-file-reference-type --strict`，确认所有测试和规格校验通过，并检查 `viewer/service.json` 的 `protocolVersion` 保持 1、未新增第三方依赖。
- [x] 5.3 按 `docs/manual-acceptance.md` 完成 Windows 端到端验收：真实系统多选/取消/越界整批拒绝、中文与空格路径、长开对话框保活、Markdown/文本/错误预览、移除与 409 草稿保留；记录实际结果，任何失败回到对应任务修复后重跑相关及全量验证。

## Workflow follow-up

- 满足项目评审要求后，由用户显式发起本 change 的 archive，并验证归档后的主规格与线程蒸馏记录。
- 发版仅由用户另行发起，并只走 `scripts/publish.mjs`；不得在本实施任务中手工改版本、打 tag 或直接 push tag。
