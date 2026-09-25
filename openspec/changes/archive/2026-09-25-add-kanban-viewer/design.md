# Design

## Context

看板线程是 `kanban/` 下的纯文件机制（见 `openspec/specs/kanban-threads/spec.md`），本 change 在其上叠加一个只读的可视化层。形态与生命周期已由探索与实测锁定（动机见 proposal.md）：kimi-code 插件 API 无 UI 扩展点；桌面端（Windows）实测触发 `SessionStart`（开 App 自动恢复上次会话时为 `source=resume`）与 `SessionHeartbeat`（严格 60s），不触发 `SessionEnd`；hook 的 stdin payload 带 `cwd` 与 `client_type`；探针实验同时验证了桌面端 hook 环境中 `node` 可用。

## Goals / Non-Goals

**Goals:**

- 零手动维护：开任意会话服务即就绪，关全部会话约 3 分钟后服务自动消失。
- 零第三方依赖、零构建：Node 内置模块 + 单文件 HTML，仓库代码即最终产物。
- 单进程服务多项目，单一固定端口，单一书签可达。

**Non-Goals:**

- Markdown 渲染、编辑或任何写操作（首版仅 `<pre>` 展示原文）。
- 展示 `openspec/` 工件或非 active 线程的浏览界面。
- 开机自启、远程访问（仅监听 127.0.0.1）、跨 CLI/桌面端差异的额外适配。

## Decisions

### 决策一：产物布局——仓库内 `viewer/` 即插件源

```
viewer/
├── kimi.plugin.json      # manifest：hooks + commands
├── commands/open.md      # /kanban:open 斜杠命令
├── server/
│   ├── ensure.mjs        # SessionStart hook：幂等拉起 + 注册 cwd
│   ├── heartbeat.mjs     # SessionHeartbeat hook：上报心跳
│   └── server.mjs        # 服务本体（http + fs，无依赖）
└── web/
    └── index.html        # 前端单文件（原生 JS）
```

插件 hook 的工作目录固定在插件根（managed copy），`./` 相对路径因此稳定；会话项目路径取自 hook stdin payload 的 `cwd`，与插件安装位置解耦。备选（全局 `config.toml` 直接配 hooks）被否：无命令注册、无打包、不可分发。

### 决策二：拉起链路与幂等

`SessionStart` → `ensure.mjs`：

```
读 stdin JSON（取 cwd）
  → GET /api/health（超时 1s）
    ├─ 200   → POST /api/register {root: cwd}，退出
    └─ 失败  → spawn(process.execPath, [server.mjs],
                     {detached:true, windowsHide:true, stdio:'ignore'}).unref()
               → 轮询 /api/health 至就绪（上限 ~5s）
               → POST /api/register {root: cwd}
```

两个会话并发 ensure 的竞态由端口 bind 天然互斥兜底：后 spawn 者 bind 失败即退出，系统最终一致。备选（PID 文件锁）被否：PID 复用与僵死文件都是坑，端口 bind 本身就是最强互斥原语。

### 决策三：清理机制——TTL 自杀，不依赖 SessionEnd

服务每 30s 检查 `now - lastHeartbeat > 180s` 则退出。TTL 取心跳间隔 3 倍：存活会话连续丢 3 次心跳的概率可忽略；误杀也无害——下次 `SessionStart` 幂等复活。备选：常驻策略被用户否（"干净一点"）；依赖 `SessionEnd` 被实测否（桌面端不触发）。`heartbeat.mjs` 只做一件事：POST `/api/heartbeat {root: cwd}`，失败静默（服务死了不抢救，留给下次 `SessionStart` 修复，保持 hook 侧极简）。心跳同时刷新注册表 lastSeen，注册表排序零成本保鲜。

### 决策四：单服务 + 固定端口 + 持久化注册表

固定端口 `4731`（单一常量定义，占用冷门高位段）；注册表存 `%KIMI_CODE_HOME%/kanban-viewer/registry.json`（hook 进程环境变量带 `KIMI_CODE_HOME`，服务继承该环境；fallback 为 `~/.kimi-code`），JSON 原子写（临时文件 + rename）。备选：每项目一服务（N 进程 N 端口，书签不可记忆）与动态端口（需端口发现机制）均被否。端口被占用时健康检查返回非本服务应答或 spawn 失败，`ensure` 将错误打到 stderr——hook fail-open，不影响会话，仅看板不可用。

### 决策五：HTTP API 形状

```
GET  /api/health                    → {ok:true, name:"kanban-viewer"}
POST /api/register   {root}         → 登记/刷新项目
POST /api/heartbeat  {root}         → 刷新 lastHeartbeat + lastSeen
GET  /api/projects                  → [{root, lastSeen}] 按最近排序
GET  /api/active-thread?root=<abs>  → {status:"ok", threadId, markdown}
                                    | {status:"no-active-thread"}
                                    | {status:"thread-missing", threadId}
GET  /                              → web/index.html
```

`active-thread` 每次请求即时读 `kanban/current` 与 `thread.md`，无缓存——看板文件由人或 Agent 随时编辑，即时读免一致性问题。仅监听 `127.0.0.1`，请求体限 64KB。

### 决策六：前端与入口

`index.html` 内嵌原生 JS：`?root=` 有参直接查该项目；无参取 `/api/projects` 首项；页面 = 项目切换下拉 + 线程标识 + `<pre>` 原文。`/kanban:open` 命令体引导 Agent 用 `cmd /c start "http://127.0.0.1:4731/?root=<当前项目根>"` 打开——Agent 知晓会话 cwd，URL 一次到位。备选（SessionStart 自动弹浏览器）被否：每次开会话都弹窗是骚扰。

### 决策七：入口补充插件 skill（桌面端实测不派发插件 commands）

实施期间实测（2026-09-25）：kimi-code 桌面端解析并在 `/plugins info` 中计数插件 `commands`，但命令既不进入补全列表、回车后也不把命令体注入会话（无 kanban 上下文的项目中 Agent 对 `/kanban:open` 完全无感知）；插件 hooks 在桌面端正常。因此新增 `skills/kanban-open/SKILL.md`（内容与 open.md 等价，description 覆盖"打开看板"与 `/kanban:open` 文本两种触发）作为桌面端入口，`commands/open.md` 保留供 CLI 使用。备选（等官方修复桌面端 commands 派发）被否：入口是首版核心价值，不能等。

## Risks / Trade-offs

- [端口 4731 被其他程序占用] → 选用冷门端口；健康检查应答带 `name` 字段便于 ensure 区分"端口被占"与"服务存活"；冲突时 hook 静默失败、斜杠命令提示用户检查。
- [GUI 启动的桌面端 hook 环境缺 `node`] → 已由探针实验实测排除（桌面端 hook 成功执行 node 脚本）；README 仍注明需 `node` 在 PATH。
- [hook 每 60s 拉起一次 node 进程的开销] → 瞬时进程、毫秒级退出，fail-open 设计不阻塞会话；这是 TTL 机制的必要成本。
- [TTL 误杀正在浏览但无会话的用户] → 可接受：刷新页面时服务已死则下次会话开始自动复活；用户明确优先"干净"。
- [注册表文件损坏（异常断电）] → 原子写降低概率；损坏时服务按空注册表启动，项目随会话心跳自然重建。

## Migration Plan

首次部署：用户在 kimi-code 中执行 `/plugins install <仓库绝对路径>/viewer`，`/reload` 或新会话生效。卸载：`/plugins remove kanban`，删除 `%KIMI_CODE_HOME%/kanban-viewer/`；仓库文件不受影响。回滚 = 卸载插件，服务 TTL 到期自灭，无残留。

## Open Questions

（无）
