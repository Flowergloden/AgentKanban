# Proposal

## Why

看板服务假设项目已具备完整的 `kanban/` 结构，实际使用障碍都出在结构缺失时：新建线程报"项目缺少 kanban/threads 目录"或"缺少卷宗模板"，活跃切换在 `kanban/` 不存在时写 `current` 直接失败，页面打开一个空白项目只能看到报错或空态却无从下手。初始化结构（建目录、放模板、建 `current`）目前是纯手动步骤，正是"对当前不合理或有障碍的交互细节进行填补"要消灭的摩擦。

## What Changes

- 服务新增初始化能力：给定项目根路径，自动创建看板最小结构——`kanban/`、`kanban/threads/`、`kanban/templates/` 目录、`kanban/templates/thread.md` 卷宗模板、`kanban/current` 空文件；已存在的路径与文件一律不动，初始化幂等。
- 服务暴露 `POST /api/init` 接口，返回本次新建的路径列表。
- 插件 SessionStart hook（`ensure.mjs`）拉起/注册服务后自动调用初始化接口，会话所在项目开箱即具备 kanban 结构。
- 写操作兜底：线程创建与活跃切换在结构缺失时自动补齐后再执行，不再返回"缺少目录/模板"类错误；创建线程优先使用项目自有模板，缺失时以内置默认模板兜底。
- 看板页面加载项目（含切换项目）时自动调用初始化接口并给出"已自动初始化"提示，旧版服务无该接口时静默跳过、不影响页面加载。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `kanban-viewer`：新增"kanban 结构初始化与自动补全"要求（初始化接口、幂等、SessionStart 自动初始化、页面加载自动初始化、写操作缺结构自动补齐）；修改"线程创建与删除接口"中创建依赖既有目录与模板的约束（模板缺失改为内置模板兜底，目录缺失自动补齐）。

## Impact

- 代码：`viewer/server/threads.mjs`（新增内置默认模板与 `ensureLayout`，`create`/`setActive`/`remove` 接入兜底）、`viewer/server/server.mjs`（新增 `POST /api/init` 路由）、`viewer/server/ensure.mjs`（注册后调用初始化）、`viewer/web/api.js` 与 `viewer/web/app.js`（页面加载自动初始化与提示）。
- API：新增 `POST /api/init`；既有接口的 4xx 行为变化——`POST /api/threads` 在结构缺失时从 400 变为自动补齐后成功，`POST /api/active-thread` 不再因缺 `kanban/` 目录 500。
- 依赖与格式：无新依赖、无构建步骤；`kanban/` 文件格式不变；内置默认模板与仓库 `kanban/templates/thread.md` 保持一致（新增常量，需随模板演进同步）。
- 分发：仓库 `viewer/` 继续镜像拷贝到 `~/.kimi-code/plugins/managed/kanban/`，本 change 完成后需同步。
- 非目标：初始化不创建 `kanban/README.md` 与 `AGENTS.md` 约定段（属项目文档，仍手动维护）；不对既有项目做结构"修复"（卷宗异常提示等行为不变）。
