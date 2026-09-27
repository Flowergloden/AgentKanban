# Tasks

## 1. 服务端：初始化原语与写操作兜底（`viewer/server/threads.mjs`）

- [x] 1.1 新增内置 `DEFAULT_THREAD_TEMPLATE` 常量，内容与仓库 `kanban/templates/thread.md` 逐字节一致——diff 常量写入临时文件与 `kanban/templates/thread.md` 比对通过
- [x] 1.2 实现 `ensureLayout(root)`：幂等创建 `kanban/`、`kanban/threads/`、`kanban/templates/`、`kanban/templates/thread.md`（缺失时）、`kanban/current`（缺失时），返回 `{ created: [...] }` 新建路径列表——临时脚本对空白目录与完整结构各跑一次：前者创建全部并返回 5 项，后者零创建零修改（文件 mtime 不变）且返回空列表
- [x] 1.3 `create()` 接入兜底：开头调用 `ensureLayout`，删除"缺少 kanban/threads 目录"与"缺少卷宗模板"两条错误路径——脚本验证：空白项目根直接创建线程成功，卷宗首行标题、`status: 立项`、四小节齐全
- [x] 1.4 `setActive()` 与 `remove()` 写 `kanban/current` 前调用 `ensureLayout`——脚本验证：`kanban/` 不存在时设置活跃先补结构再写入，无 ENOENT 500

## 2. 服务端：初始化路由（`viewer/server/server.mjs`）

- [x] 2.1 新增 `POST /api/init`（body 含 `root`，复用 `requireRoot` 校验）返回 `{ ok: true, created }`——`curl` 验证空白项目返回 5 项 created，重复调用返回空列表且既有文件内容不变

## 3. 插件 hook：会话启动自动初始化（`viewer/server/ensure.mjs`）

- [x] 3.1 服务就绪并完成 register 后，2s 超时调用 `POST /api/init`（root=会话 cwd），异常静默不阻塞会话——端到端：删掉测试项目的 `kanban/` 后执行 `echo '{"cwd":"<root>"}' | node ensure.mjs`，`kanban/` 结构自动重建

## 4. 前端：页面加载自动初始化与提示（`viewer/web/`）

- [x] 4.1 `api.js` 新增 `init(root)` 方法——页面 import 无 404，DevTools 网络面板可见请求
- [x] 4.2 `app.js` 初始加载与切换项目统一走"先 `api.init(root)`（失败静默）再 `refresh(root)`"；`created` 非空时显示一次性"已自动初始化：…"提示——端到端：对空白项目打开页面，自动出现 kanban 结构、页面给出提示且新建线程可用；模拟旧版服务（init 404）页面照常加载

## 5. 验证与收尾

- [x] 5.1 全流程回归：临时项目根上 curl 验证 创建线程→设为活跃→删除（含活跃二次确认路径）→初始化幂等，各接口行为与本 change spec delta 一致
- [x] 5.2 `openspec validate add-kanban-init --strict` 通过
- [x] 5.3 仓库 `viewer/` 镜像同步到 `~/.kimi-code/plugins/managed/kanban/`（`diff -rq` 无差异），并用 managed copy 的 `ensure.mjs` 重跑 3.1 的端到端
