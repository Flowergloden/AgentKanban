# Design

## Context

现状与约束（动机见 proposal.md - Why）：

- `viewer/server/threads.mjs` 的 `create()` 在 `kanban/threads` 目录缺失时报 `bad-request`（"项目缺少 kanban/threads 目录"），模板文件缺失时回滚已建目录并报错；`setActive()`/`remove()` 经 `atomicWrite` 写 `kanban/current`，`kanban/` 不存在时底层 `ENOENT` 冒泡为 500。
- `viewer/server/server.mjs` 暂无初始化类路由；`POST /api/register`、`/api/heartbeat` 已携带项目根路径。
- 插件分发为仓库 `viewer/` 镜像拷贝到 `~/.kimi-code/plugins/managed/kanban/`，无 npm 依赖、无构建步骤；升级靠重新拷贝，线上可能存在旧版服务进程（前端可能连到没有新接口的服务）。
- 卷宗模板 SSOT 是仓库 `kanban/templates/thread.md`；插件运行时不能依赖仓库路径，模板内容需以常量内置在服务端模块中。
- 心跳维持服务 180s TTL 自杀；SessionStart hook（`ensure.mjs`）已负责拉起服务与注册项目。

## Goals / Non-Goals

**Goals:**

- 一个幂等的 `ensureLayout(root)` 原语：补齐 kanban 最小结构（目录 + 模板 + 空 `current`），返回本次新建路径列表。
- 初始化可通过三条路径触发：显式 API（`POST /api/init`）、SessionStart hook 自动、页面加载自动；写操作（创建/活跃切换/删除活跃线程）缺结构时自愈。
- 创建线程模板选择：项目自有模板优先，缺失用内置默认模板兜底。

**Non-Goals:**

- 不创建 `kanban/README.md`、`AGENTS.md`（项目文档，人工维护）。
- 不修复既有卷宗的内容异常（`thread-invalid` 等提示行为不变）。
- 不做服务版本协商协议；旧版服务仅靠前端的容错降级处理。

## Decisions

### 1. `ensureLayout` 放在 `threads.mjs` 并导出，服务路由薄封装

新增 `export async function ensureLayout(root)`：逐个 `mkdir(recursive)` 三个目录，`templates/thread.md` 与 `current` 仅在不存在时创建（内置 `DEFAULT_THREAD_TEMPLATE` 常量，内容与仓库模板逐字节一致）。`server.mjs` 的 `POST /api/init` 只做参数校验并透传返回值。

- 备选：在 `server.mjs` 内实现 → 拒绝；`kanban/` 全部读写逻辑已在 `threads.mjs` 收口，路由层保持无业务逻辑。
- 幂等性靠"仅不存在时创建"保证，返回值 `{ created: [...] }` 供前端提示。

### 2. 模板兜底采用内置常量，不复制仓库文件

`DEFAULT_THREAD_TEMPLATE` 内嵌于 `threads.mjs`（字符串常量，内容与 `kanban/templates/thread.md` 一致）。创建线程时：模板文件存在 → 读文件使用；不存在 → `ensureLayout` 已用内置常量创建，读取自然成功，代码路径不分裂。

- 备选：服务启动时从某个全局位置拷贝模板 → 拒绝；分发链路上插件拿不到仓库路径，内置常量是唯一自洽方案。
- 代价：仓库模板演进时需同步常量（在 tasks 中列为检查项）。

### 3. 写操作自愈：改 `create`/`setActive`/`remove`，读接口不动

`create` 开头调用 `ensureLayout`（原"缺少目录"错误路径删除）；`setActive`/`remove` 写 `current` 前调用。`parseList`/`getThread`/`queryActiveThread` 等读接口保持宽容但不创建任何文件——避免"看一眼就落盘"的副作用。

### 4. SessionStart hook 自动初始化，失败静默

`ensure.mjs` 在服务就绪并完成 register 后，用 2s 超时 `POST /api/init`（root=会话 cwd），异常吞掉——初始化失败不阻塞会话启动（用户仍可从页面触发）。

- 备选：心跳时也初始化 → 拒绝；无收益且放大写盘频率。会话启动一次足够。
- 影响：未装/未启用插件的项目不受影响；启用插件的项目会话启动后自动出现 `kanban/` 结构，这是本 change 的预期行为。

### 5. 前端在 root 确定后主动 init，失败静默降级

`app.js` 在初始加载与切换项目两处统一走"先 `api.init(root)`（失败忽略），再 `refresh(root)`"；init 返回的 `created` 非空时显示一次性提示"已自动初始化：…"。旧版服务返回 404 → `.catch` 吞掉，刷新照旧。

- 备选：后端在 `GET /api/threads` 里隐式 init → 拒绝；读接口不落盘的原则更干净，且页面侧能拿到 `created` 列表做用户提示。

## Risks / Trade-offs

- 内置模板与仓库模板漂移 → tasks 增加一项：改仓库模板后检查常量一致性；两者目前完全一致，漂移面小。
- 服务进程可能为旧版（TTL 自杀 + 新会话重新拉起，升级后至多存活 180s）→ 前端 `.catch` 降级已覆盖过渡期。
- 空白项目被自动创建 `kanban/` 后用户困惑文件来源 → 页面给出"已自动初始化"提示；`kanban/README.md` 未被创建，用户可在需要时自行添加。
- `ensureLayout` 在每次写操作时多几次 stat/mkdir（幂等检查）→ 本地服务、低频写操作，开销可忽略。

## Migration Plan

无需数据迁移。部署 = 重新镜像拷贝 `viewer/` 到 managed 目录；旧服务进程自然过期后由下次 SessionStart 拉起新版本。
