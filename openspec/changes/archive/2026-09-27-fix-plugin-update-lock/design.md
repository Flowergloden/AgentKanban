# Design

## Context

现状与约束（动机见 proposal.md）：

- 官方行为：插件 hook 以插件根目录为工作目录运行；`ensure.mjs` spawn 服务时未传 `cwd`，服务进程继承托管目录为工作目录，Windows 下该目录被钉死。
- 服务已有心跳 TTL（180 秒）自动退出机制；无主动退出接口；`/api/health` 仅返回 `{ ok, name }`。
- 存量用户运行的是 v0.2.1 服务：无 cwd 修复、无 shutdown 端点、health 无版本字段——升级路径必须兼容这一版。

## Goals / Non-Goals

**Goals:**

- 覆盖安装插件时无需杀进程（根治托管目录锁）。
- 插件更新后，运行中的旧版服务自动换代为新版，无需用户干预。
- 从 v0.2.1 升级的路径平滑：仅这最后一次需要手动杀进程。

**Non-Goals:**

- 不做插件自动更新或更新检测（zip-url 安装无更新提示是独立问题，不在本 change 范围）。
- 不改变心跳 TTL 自动退出机制与心跳 hook 的行为。
- 不处理"服务运行中静态资源被替换"的瞬时窗口之外的一致性问题（如旧代码+新前端混跑期间的功能对齐）。

## Decisions

### D1：服务进程工作目录外置到 `os.tmpdir()`

`ensure.mjs` spawn 时显式传 `cwd: os.tmpdir()`。tmpdir 必然存在、可写、语义上是"进程 scratch 空间"，与用户数据和插件目录均无关。

备选：

- `registryDir`（`~/.kimi-code/kanban-viewer`）：语义也对，但 spawn 前必须先确保目录存在，多一步；tmpdir 零前置条件。
- 影子拷贝（把 server/web 复制到插件目录外再运行）：同样根治锁，但引入拷贝、版本戳、资源同步等复杂度，收益不增。
- 推动 kimi-code 增加 pre-update 生命周期钩子：不可控，不阻塞本修复。

### D2：版本即换代信号

server 启动时读取插件 manifest（`../kimi.plugin.json`）的 `version`，`/api/health` 响应携带；`ensure.mjs` 读取自身旁路的同一 manifest 得期望版本。发布流水线（release.yml）已有版本一致性校验，每次发布版本必变，无需额外 build id。

备选：内容哈希（实现复杂）；进程启动时间戳（同版本重装会误触发换代）。

### D3：换代协议放在 ensure.mjs，心跳路径不动

ensure 流程变为：health 不通 → 直接 spawn（现状）；health 通但版本不一致 → `POST /api/shutdown`（短超时）→ 轮询 health 直至不可用（约 3 秒上限）→ spawn 新版 → 复用既有就绪等待与注册逻辑。shutdown 请求失败或超时（旧版无此端点）→ 退化为直接复用，不报错、不重复 spawn。

心跳 hook（heartbeat.mjs）保持极简现状：换代只在 SessionStart 发生已足够，让每次心跳多一次 health 往返收益低。

### D4：shutdown 端点语义最小化

`POST /api/shutdown`：先响应 200，再在下一个事件循环 tick 退出（`process.exit(0)`）。注册表本就随写操作即时持久化，无需退出前特殊处理。服务仅监听 127.0.0.1，本地威胁模型与既有接口一致，不引入鉴权。

## Risks / Trade-offs

- 重装瞬间旧服务可能正持有 web 静态文件的读句柄 → 瞬态 404，窗口毫秒级，换代后彻底消失。可接受。
- 同版本重装（版本号未变）不触发换代，旧代码常驻 → 仅开发调试场景；可手动调 `/api/shutdown` 或等 TTL，release notes 注明即可。
- 多会话同时启动可能并发换代：shutdown 幂等，重复 spawn 经端口竞争收敛（败者 `server.on('error')` 退出）→ 仍为单实例。
- v0.2.1 → v0.2.2 的升级本身仍需最后杀一次进程（旧版锁仍在）→ release notes 保留一次性说明，此后永久免杀。

## Migration Plan

1. 实现并随 v0.2.2 发布（release.yml 现有流水线）。
2. 用户最后一次按 v0.2.1 的方式杀进程（或关闭所有会话等 TTL）后重装恒定 latest URL。
3. 之后的所有更新：`/plugins install <恒定 URL>` + `/reload`，零进程操作。
4. 回滚：重装旧版本 zip 即可；新旧版本协议向后兼容（新版 ensure 可复用旧版服务，旧版 ensure 不认识新版 health 的版本字段也无碍——其 isAlive 只检查 `ok` 与 `name`）。

## Open Questions

- 是否顺带提供 `/kanban:stop` 命令（基于 shutdown 端点）作为人工排障入口：不影响本 change 的 spec 与实现路径，可在实施时或后续单独决定。
