# Tasks

## 1. 服务端：创建行为调整与重命名接口

- [x] 1.1 调整 `viewer/server/threads.mjs` 的 `create()`：slug 留空且 slugify 产出为空时以 `unnamed-pending` 占位并豁免 slug 冲突检查；显式传入 `unnamed-pending` 报 `bad-request`。验证：node 脚本以中文标题连续创建两条线程，目录分别为 `000X-unnamed-pending`、`000Y-unnamed-pending` 且不冲突；显式传标记值返回错误
- [x] 1.2 在 `viewer/server/threads.mjs` 新增 `rename()`：kebab-case 校验、保留字拒绝、冲突检查排除自身（slug 不变时幂等返回）、目录改名、活跃时同步 `kanban/current`（先改目录后写 current）。验证：node 脚本逐一覆盖 delta spec「线程重命名接口」五个 Scenario 的预期结果
- [x] 1.3 在 `viewer/server/server.mjs` 注册 `POST /api/threads/:id/rename` 路由，复用现有 `ThreadError` 到状态码的映射。验证：curl 分别实测成功（200 返回新 id）、非法 slug（400）、保留字（400）、冲突（409）、线程不存在（404 或对应明确状态）

## 2. 插件约定与文档

- [x] 2.1 扩展 `viewer/SYSTEM.md` 约定一：命中 `-unnamed-pending` 精确匹配时先自动命名（生成英文 kebab-case slug、调 rename 接口、冲突换名重试、失败跳过并说明、仅活跃线程、不询问用户），复述中报告结果；保持四条约定总数不变。验证：通读约定文本，命名步骤完整且无第五条约定出现
- [x] 2.2 更新 `kanban/README.md`：创建线程的 slug 规则说明（英文标题自动生成、非英文标题进入待命名态由 Agent 校准命名）、`unnamed-pending` 保留字、手动 rename 操作方式。验证：通读 README 与新行为一致
- [x] 2.3 将 change 名 `add-deferred-thread-naming` 登记到线程 `0003-ergonomic-improvements` 卷宗的 `## Changes` 列表。验证：卷宗 Changes 小节包含该条目
- [x] 2.4 插件版本号 `viewer/kimi.plugin.json` 从 0.2.2 升到 0.2.3（约定文本变更随版本分发，触发旧服务换代）。验证：manifest version 为 0.2.3，健康检查接口报告同版本

## 3. 网页 UI

- [x] 3.1 更新 `viewer/web/modals.js` 创建模态框 slug 提示文案：说明留空时英文标题自动生成、非英文标题将由 Agent 在会话校准时自动命名。验证：浏览器打开看板页面新建线程弹窗，文案与实际行为一致

## 4. 端到端验证

- [x] 4.1 全流程实测：网页创建中文标题线程（slug 留空）→ 目录为 `unnamed-pending`；模拟校准路径 curl rename 接口改名 → 目录更名、活跃时 `current` 同步；看板页面各视图显示正常。验证：上述每步可观察结果符合 delta spec 对应 Scenario
- [x] 4.2 运行 `openspec validate add-deferred-thread-naming --strict` 通过。验证：命令退出码为 0
