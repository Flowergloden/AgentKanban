# Design

## Context

现状与约束（动机见 proposal.md - Why）：

- `viewer/server/server.mjs`：143 行零依赖 node http 服务（127.0.0.1:4731），已有注册表持久化（tmp+rename 原子写）、TTL 自杀、静态托管仅限 `index.html`。当前对 `kanban/` 只读。
- `viewer/web/index.html`：单文件 vanilla JS（约 50 行脚本），fetch + `<pre>` 原文展示，支持 `?root=` 参数与项目切换。
- 分发链路：仓库 `viewer/` 镜像拷贝到 `~/.kimi-code/plugins/managed/kanban/`，全程无 npm install，用户浏览器可能离线 → 任何前端库必须 vendor 进 `viewer/web/`，禁止 CDN。
- `kanban/` 文件格式由 `kanban/templates/thread.md` 固定：首行 `# 标题`、`status: X` 行、四个 `## ` 必备小节。Agent 是第二写者（AGENTS.md 约定二/三会追加卷宗），与页面写操作可能并发。

## Goals / Non-Goals

**Goals:**

- 服务端新增线程解析层：各 `thread.md` → 线程表投影（列表字段 + 详情小节 + 文件指纹），SSOT 仍是文件，不引入新存储。
- 服务端新增写接口：小节更新（乐观并发）、status 流转、创建、删除、活跃切换；全部原子写盘。
- 前端重写为组件化单页：三内置视图（表格/按状态看板/未完成）、详情页分小节编辑、创建/删除/活跃切换入口、409 冲突提示；保持 `?root=` 与项目切换行为。
- 静态托管扩展为托管 `viewer/web/` 整目录（多文件 ES modules）。

**Non-Goals:**

- 用户自定义视图及其持久化、甘特图/依赖关系图、markdown 渲染阅读模式、搜索（另开线程）。
- 构建工具链、npm 依赖、TypeScript。
- `kanban/README.md`、`AGENTS.md` 文档更新（手动操作语义不变）。
- 看板服务的版本检测与热升级（见 Risks）。

## Decisions

### 服务端分层：解析/写盘拆为独立模块

`server.mjs` 保留路由与生命周期；新增 `viewer/server/threads.mjs` 承担全部 `kanban/` 读写：

```
server.mjs          threads.mjs                 kanban/
 路由/心跳/TTL  -->   parseThread(text)           threads/<id>-<slug>/thread.md
 静态托管        -->   parseList(root)            current
                      updateSection(...)          templates/thread.md
                      setStatus / create / remove / setActive
                      （全部 tmp+rename 原子写）
```

备选：全部堆进 server.mjs——否决，写逻辑（小节切分、指纹校验、模板套用）值得独立模块，且便于将来单测。

### 文件指纹 = 内容 SHA-256，而非 mtime

详情接口返回 `fingerprint`（卷宗内容的 SHA-256 hex）与 `mtimeMs`（仅用于显示/排序）。写接口携带 fingerprint，写前重算当前文件 hash 比对，不一致返回 409。理由：内容相等才是"未变更"的真实语义；mtime 在 git 操作、跨工具写入下语义不稳。备选 mtime 指纹——否决，但 mtime 仍随列表返回用于"最近更新"列。

### 小节替换：按 `## ` 标题行切片，只换正文

解析按 `## ` 标题行把卷宗切成有序小节；更新 = 定位目标小节、替换标题行之后的正文、其余字节原样保留（含模板注释）。**空行兼容**：接口层对小节内容做"净内容"转换——读出时裁掉正文首尾的结构性空行（模板排版所致），写入时按规范补回（标题行后一空行、正文末尾与下一标题行之间一空行），使页面展示与编辑框不见结构空行、落盘文件格式不漂移。status 流转 = 只改 `status:` 行的值。写前重新解析校验目标小节存在；卷宗缺必备小节时接口返回明确错误，不擅自补全。解析宽容（缺标题行、缺 status 行 → 列表中标"卷宗异常"），写操作严格。

### API 形态

全部 JSON，沿用现有风格（query 传 root，body 传参数，错误用明确状态码）：

```
GET    /api/threads?root=           -> { threads: [{id,title,status,mtimeMs,active,goalExcerpt,error?}] }
GET    /api/thread?root=&id=        -> { id,title,status,sections:{目标,已完成的工作,决策,Changes},fingerprint,mtimeMs }
PUT    /api/thread/section          {root,id,section,content,fingerprint} -> 200 {fingerprint} | 409 | 4xx
POST   /api/thread/status           {root,id,status}   // 校验四态
POST   /api/threads                 {root,title,slug?} -> {id} | 409(id/slug 冲突)
DELETE /api/thread                  {root,id}          // 真删；删活跃线程时清空 current
POST   /api/active-thread           {root,id|null}     // 设置/取消活跃
```

既有 `/api/active-thread`(GET) 等只读接口保持不动，旧页面行为不破坏。

### 前端：Preact + htm 单文件 standalone bundle，无构建

vendor 一个文件：`htm/preact/standalone.module.js`（官方构建，内含 preact + hooks + htm 绑定，约 15KB），置于 `viewer/web/vendor/` 并注释来源与版本。`index.html` 用 `<script type="module">` 引 `app.js`，组件拆为若干 ES module 文件（app.js / api.js / views-table.js / views-board.js / detail.js / modals.js），server 静态托管整目录并补 content-type 映射。

理由（对比已在探索阶段完成）：分发链路无 npm、浏览器可能离线 → 必须 vendored 无构建；Preact+htm 是唯一同时满足组件模型、体积极小、生态活跃的选项。备选：Vue global build（约 150KB，语法熟悉度取胜时可选）、vanilla（可行为但给未来视图线程留命令式 DOM 债）、React+Vite（引入首条工具链，本项目哲学暂不接受）。

组件与状态：

```
App (projects, root, view, threads, selectedThread)
 ├─ Header: 项目切换 + 视图标签 + [新建线程]
 ├─ TableView / BoardView / UnfinishedView(=TableView+filter)
 ├─ ThreadDetail: 标题/status/活跃切换 + 四个小节
 └─ Modals: 新建线程 / 删除确认(活跃时二次确认)
```

无路由库：视图与选中线程存于 App state，`?root=` 仅在初始化读取（行为同现版）。无状态库：useState/useEffect + api.js fetch 封装足够。

### 编辑权限的前端实现

- `## 目标`：阅读态显示原文，单击（或铅笔图标）直接进入编辑态——"随手可改"。
- `## 决策` / `## 已完成的工作` / `## Changes`：阅读态 + 显式 [编辑] 按钮，点击才解锁编辑态。
- 编辑态统一为 textarea + 保存/取消；保存成功用响应里的新 fingerprint 更新本地；409 显示横幅"文件已被修改（可能被 Agent 更新）"+ [重新加载]（丢弃本地编辑，用户可先自行复制 textarea 内容）。

### 看板拖拽：原生 HTML5 DnD，不调库

卡片 `draggable`，列容器 `dragover`/`drop`；drop 后调 status 接口，失败则重新拉取列表回滚显示。拖拽期间列高亮。Preact 用原生事件（无合成事件层），与原生 DnD 天然契合。

### 创建/删除流程

- 创建弹窗：标题必填；slug 选填（校验 kebab-case）。留空时服务端从标题提取 ASCII 字母数字生成 slug，标题无 ASCII 字符时退化为 `thread`（冲突报错不覆盖）。id = 扫描目录取最大序号 +1（4 位零填充）。
- 删除：普通线程一次确认（展示目录名）；活跃线程追加第二次确认（明示将同时取消活跃）。服务端删活跃线程时清空 `kanban/current`，与前端确认解耦（双重保障）。

## Risks / Trade-offs

- **解析脆弱性**：thread.md 格式靠模板约定而非 schema，用户手改结构（删小节、改标题层级）会解析失败 → 宽松解析 + 列表标"卷宗异常"、写操作前重解析校验、缺小节报明确错误而不补写。
- **并发覆盖**（Agent 按约定追加卷宗 vs 页面编辑）→ 内容 hash 乐观并发 + 409 横幅；写操作离散低频，不引入锁。
- **分发后旧服务仍在跑**：TTL 自杀依赖心跳停止，桌面端会话常开时旧版服务可能长期存活，新代码不生效 → 实施期间手动结束进程验证；分发后提示重启会话。服务版本自检自愈留作后话。
- **vendored 库的手工更新**：无 npm audit → vendor 文件头注释记录版本与来源 URL，更新即替换文件。
- **中文标题生成 slug 退化**为 `thread`：可读性差但合法；用户可在创建弹窗中显式指定 slug。
- **列表/看板无自动刷新**：另一窗口改动后不自动同步 → v1 手动刷新；视图状态简单，刷新成本低。

## Migration Plan

无数据迁移：`kanban/` 文件格式不变，手动操作路径保持有效。部署 = 插件镜像同步 `viewer/` 目录；已运行的看板服务进程需结束（或等 TTL 自杀）后由 hook 拉起新版。回滚 = git revert 本 change 的实现提交并重启服务。

## Open Questions

- 列表/看板是否需要轮询或窗口聚焦时自动刷新——v1 手动刷新，视使用体验在视图线程中再议。
