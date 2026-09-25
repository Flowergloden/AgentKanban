# Tasks

## 1. 服务本体（viewer/server/server.mjs）

- [x] 1.1 实现 HTTP 服务骨架：仅监听 `127.0.0.1:4731`（端口为单一常量），`GET /api/health` 返回 `{ok:true,name:"kanban-viewer"}`，请求体限 64KB；验证：`node viewer/server/server.mjs` 启动后 `curl http://127.0.0.1:4731/api/health` 返回期望 JSON
- [x] 1.2 实现注册表：`POST /api/register` 登记 root 并刷新 lastSeen，`GET /api/projects` 按 lastSeen 降序返回；持久化到 `%KIMI_CODE_HOME%/kanban-viewer/registry.json`（无该环境变量时 fallback `~/.kimi-code`），原子写（临时文件+rename），损坏时按空注册表启动；验证：register 两个项目后 projects 排序正确，杀掉进程重启服务后列表仍完整
- [x] 1.3 实现 `POST /api/heartbeat`（刷新 lastHeartbeat 与该 root 的 lastSeen）与 TTL 自杀（每 30s 检查，超过 180s 无心跳则退出）；验证：POST 一次心跳后不再操作，观察进程约 3 分钟后自行退出且端口释放
- [x] 1.4 实现 `GET /api/active-thread?root=<abs>`：读 `<root>/kanban/current` → 返回 `{status:"ok",threadId,markdown}` / `{status:"no-active-thread"}` / `{status:"thread-missing",threadId}` 三态，即时读文件无缓存，对 `kanban/` 只读；验证：对本项目查询返回 `0002-kanban-board-visualization` 的 thread.md 原文；临时置空 current 返回 no-active-thread；指向不存在目录返回 thread-missing（验证后恢复现场）
- [x] 1.5 实现 `GET /` 静态托管 `viewer/web/index.html`；验证：先用占位 HTML 验证 `curl http://127.0.0.1:4731/` 返回 200 与正确 Content-Type（最终页面在任务 2 交付）

## 2. 前端页面（viewer/web/index.html）

- [x] 2.1 实现单文件页面（原生 JS，无构建）：`?root=` 参数定位项目；无参时取 `/api/projects` 首项并显示项目切换下拉；三种 active-thread 状态与空注册表各有明确提示；active thread 以 `<pre>` 展示 thread.md 原文；验证：浏览器带参/无参打开均正确显示本项目 active thread 原文，下拉可切换已注册项目，无活跃线程时显示明确提示而非空白

## 3. 拉起与心跳脚本

- [x] 3.1 实现 `viewer/server/ensure.mjs`：读 stdin JSON 取 `cwd`；`GET /api/health`（超时 1s）成功则直接 register，失败则以 `{detached:true, windowsHide:true, stdio:'ignore'}` spawn `server.mjs` 并 `unref()`，轮询健康检查至就绪（上限约 5s）后 register；验证：服务停止时执行 `echo {"cwd":"<项目根>"} | node viewer/server/ensure.mjs`，服务无终端窗口拉起且 projects 含该项目；服务已运行时再次执行不产生第二个服务进程
- [x] 3.2 实现 `viewer/server/heartbeat.mjs`：读 stdin 取 `cwd`，POST `/api/heartbeat`，任何失败静默且退出码 0；验证：服务运行时执行后注册表 lastSeen 被刷新；服务停止时执行无报错输出、退出码为 0

## 4. 插件打包

- [x] 4.1 编写 `viewer/kimi.plugin.json`（`name:"kanban"`；hooks：`SessionStart`→`node ./server/ensure.mjs`、`SessionHeartbeat`→`node ./server/heartbeat.mjs`，合理设置 timeout；`commands:"./commands/"`）与 `viewer/commands/open.md`（引导 Agent 用 `cmd /c start` 打开 `http://127.0.0.1:4731/?root=<当前项目根>`）；验证：`/plugins install <仓库绝对路径>/viewer` 后 `/plugins info kanban` 无诊断错误且计入 2 hooks + 1 command（注：桌面端实测不派发插件 commands 到命令列表，详见 design 决策七）
- [x] 4.2 新增 `viewer/skills/kanban-open/SKILL.md` 并在 manifest 声明 `skills:"./skills/"`，作为桌面端入口；验证：重装插件后新会话中 skill 列表出现 `kanban-open`，触发后 Agent 按指引打开看板页

## 5. 端到端验证（kimi-code 桌面端实机）

- [x] 5.1 安装插件后开新会话，验证 `SessionStart` 自动拉起服务：健康检查可访问、全程无终端窗口、注册表包含当前项目
- [x] 5.2 在会话中触发看板入口（桌面端用 `/skill:kanban-open` 或自然语言"打开看板"），验证默认浏览器打开并显示本项目 active thread 的 thread.md 原文
- [x] 5.3 在另一个项目目录下开会话（任意含 `kanban/` 的项目），验证注册表新增该项目且前端下拉可切换
- [x] 5.4 关闭全部 kimi-code 会话，等待约 3 分钟，验证服务进程退出、端口 4731 释放
