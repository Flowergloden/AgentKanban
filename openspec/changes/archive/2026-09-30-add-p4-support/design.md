# Design

## Context

服务对项目 `kanban/` 的全部写操作汇聚于 `viewer/server/threads.mjs`：内容覆写统一走 `atomicWrite`（临时文件 + 重命名），目录操作集中在 `create`/`rename`/`remove`，`ensureLayout` 惰性创建模板、`current`、`note.md` 三件套。服务进程由 `manager.mjs` 以 `cwd=os.tmpdir()` 派生，因此任何 p4 调用都必须显式以项目根为工作目录。

Windows 行为是本变更的主战场：rename 覆盖只读目标返回 EPERM，删除只读文件返回 EPERM，写只读文件返回 EACCES/EPERM；POSIX 上 rename/unlink 只看目录权限，只读位不挡，但直接写文件两端一致失败。现状代码对只读/VCS 零感知，失败表现为不透明的 HTTP 500。

注册表（`~/.agent-kanban/registry.json`）已有按项目根持久化 `lastSeen` 的先例，原子写盘，新增字段向后兼容。

## Goals / Non-Goals

**Goals:**

- 实现 delta spec 的全部 Requirement：检测与缓存、徽标、写盘前 checkout、fstat 门控的删除/重命名、弹窗问 add、EPERM 兜底、错误呈现。
- 热路径（内容覆写）每次写最多一次 p4 spawn；非 P4 项目零 p4 调用、零行为变化。
- 零新增 npm 依赖；测试不依赖真实 Perforce 服务器。

**Non-Goals:**

- 不执行 `p4 submit`，不做 changelist 管理（打开的文件留在默认 changelist，用户自行提交）。
- 不实现 Git 支持，仅保证注册表 `vcs` 字段形状可容纳后续扩展。
- 不改动四条 Agent 常驻约定；Agent 直接编辑卷宗的场景由项目自身 prompt 指导。
- 不做未托管文件的界面补救入口，不做手动刷新检测入口。

## Decisions

### 1. 检测动词用 `p4 where` 而非 `p4 info`

`p4 where kanban/...` 是纯客户端视图映射计算，不联系服务器——服务器不可达（如 VPN 断开）不会造成"非 P4"假阴性；"受不受管"是客户端视图属性，与服务器可达性正交。前置 `p4 -V` 判断 CLI 可用性。备选 `p4 info` 需服务器可达，会把"服务器宕机"误判为"非 P4"，否决。实现期首先实测验证 `p4 where` 的离线行为；若与预期不符，退回 `p4 info` 并区分"服务器不可达"与"未映射"两类结果。

### 2. 检测结果持久化在注册表，按项目条目缓存

注册表条目新增可选字段 `vcs: { type: "p4", checkedAt }`；检测为非 P4 时记录 `{ type: null, checkedAt }`，字段缺失表示"未检测"。检测时机为项目注册与 `/api/init`（页面加载/切换项目的必经路径），每次执行并刷新字段。写路径读取缓存值决定行为；字段缺失时按非 P4 处理，由 EPERM 兜底阶梯纠正。备选"内存缓存 + TTL"跨重启即失效、下拉框渲染非加载项目时无数据，否决；注册表方案与既有 `lastSeen` 模式同构。

### 3. p4 封装集中在新模块 `vcs.mjs`，写路径注入点唯一

`viewer/server/vcs.mjs` 导出 `detect(root)`、`edit(root, file)`、`add(root, files)`、`del(root, path)`、`move(root, oldPath, newPath)`、`fstat(root, file)`，内部统一 spawn（`cwd: root`、超时约 10 秒、`p4` 不存在则整个项目按非 P4 处理）。返回值做三态分类：`ok` / `unmanaged`（p4 输出属"no such file"/"not in client"/"not under client"类，落回普通文件操作）/ hard-fail（携带 p4 原始原因）。`threads.mjs` 的 `atomicWrite` 外层包一个"覆写前按需 checkout"的包装；`create`/`rename`/`remove` 在各自分支调用对应动词。

热路径（`edit`）盲调 `p4 edit`，不先 `fstat`——`p4 edit` 对已打开、已 add 的文件幂等成功（实现期验证），保持每次写一次 spawn。冷路径（rename/delete）才付出一次 `fstat` + 一次动词调用。

### 4. rename/delete 的 fstat 门控矩阵

`fstat` 解析 headAction / openAction 判定三态，动词选择：

```
  文件状态                     remove                rename
  ============================================================================
  已入 depot 且非 open-for-add  p4 delete             p4 move old new
  open-for-add(未提交)         p4 revert + 普通删除   FS 改名 + revert 旧路径 add
                                                     + add 新路径
  未托管                       普通删除               FS 改名
```

此矩阵消解 move 语义与 new+delete 语义的混淆：`p4 move` 需要 depot 源版本作支点，open-for-add 文件没有支点，走"revert + add"等价于"未提交新增的移动"。实现期验证点：`p4 move` 对 open-for-edit 源文件的行为、目标目录不存在时是否自建、目标已存在的处理；`p4 delete` 对 open-for-edit 文件是自动转 delete 还是报错；`p4 revert` 对"文件已不在旧路径"的 open-add 记录的行为。任何验证不符的分支落回普通文件操作 + 明确错误上报（用户可 `p4 reconcile` 收尾，reconcile 自带基于内容的改名检测）。

### 5. 新建文件经 `created` 列表驱动弹窗问 add

`create` 与 `ensureLayout` 收集本次新建文件的相对路径（排除 `*.tmp`），写接口响应携带 `created: [...]`。前端在 `vcs.type === "p4"` 且 `created` 非空时弹模态框批量列出文件，提供「p4 add」与「不 add」；确认时调新增接口 `POST /api/vcs/add`（body `{ root, files[] }`），服务端逐条校验解析后的绝对路径位于 `<root>/kanban/` 内再执行 `p4 add`。拒绝则关闭弹窗，不记忆、不就同一批文件重复询问；后续操作产生新文件时仍正常弹窗。备选"自动 add"会在用户 changelist 留下无感知痕迹、"持久角标 + 批量补救入口"均已在探索阶段被否决。

### 6. 错误呈现沿用现有通道

p4 hard-fail 包装为携带明确原因的 `ThreadError`（如"P4 checkout 失败：文件被锁定"），经 `server.mjs` 既有错误映射返回；页面沿用现有错误提示通道展示，不新增 UI 体系。`atomicWrite` 的 EPERM/EACCES 兜底阶梯：重新检测一次 → 翻转为 P4 则按 P4 路径重试一次 → 仍失败则返回明确错误。

### 7. 测试策略：假 p4 shim

新增测试以 node 脚本 shim 冒充 `p4` 可执行文件，置于临时 PATH，按环境变量/参数脚本化地模拟：CLI 可用性、`where` 映射与否、`fstat` 各状态、各动词的成功与两类失败、只读位行为。覆盖检测缓存读写、门控矩阵三分支、EPERM 兜底重试、`created` 响应与 add 接口越界拒绝。沿用 `viewer/test/` 现有 node:test 风格；只读位语义以 Windows 为准。

## Risks / Trade-offs

- [p4 spawn 延迟（每次写约 100-300ms）] → 仅 P4 项目付费；热路径保持一次 spawn；opened 状态短期缓存留作后续优化，本期不做。
- [`p4 where` 离线行为与预期不符] → 实现期最先验证；不符则退回 `p4 info` 并区分服务器不可达与未映射。
- [`p4 move`/`p4 delete`/`p4 revert` 在各打开状态下的行为存在版本差异] → 实现期逐项实测；异常分支落回普通文件操作，错误明确上报，不阻塞整体。
- [用户默认 changelist 会持续累积服务打开的文件] → 设计上服务永不 submit；由用户在 P4V/CLI 自行提交，符合"版本管理主权在用户"的定位。
- [两台机器并发改同一卷宗] → 属 P4 提交层语义（与 Git 同理），服务不引入合并逻辑；本机并发仍由指纹 409 机制保证。
- [假 p4 shim 与真实 p4 行为偏差] → 测试只锁定实现所依赖的行为子集；验证清单在实现期对真实 p4 逐项实测。

## Migration Plan

注册表新增可选字段，旧数据缺省即"未检测"，首次注册或加载时自动补齐，无需迁移。非 P4 项目零行为变化；升级后既有测试全套保持绿。发布沿用既有流程：`service.json` 与 `kimi.plugin.json` 提升次版本号，插件目录同步。
