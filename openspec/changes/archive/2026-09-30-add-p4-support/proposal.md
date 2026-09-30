# Proposal

## Why

受 P4（Perforce）版本管理的项目（如 VibeRPG）中，sync 下来的 `kanban/` 文件带只读位，只有 `p4 edit`（checkout）后才可写。看板服务的全部写路径——卷宗小节保存、status 流转、活跃线程切换、便签保存、线程创建/重命名/删除——在这类项目上都会失败：Windows 上 rename 覆盖只读目标与删除只读文件均返回 EPERM，当前表现为不透明的 HTTP 500。此前已修复读取侧兼容（UTF-8 BOM），本次解决写入侧。

## What Changes

- 新增 VCS 检测层：项目注册与看板页面加载/切换项目时，检测该项目 `kanban/` 是否受 P4 管理（基于 `p4 where` 的客户端视图映射计算，不依赖服务器可达），结果以 `vcs` 字段缓存进注册表；字段形状为 Git 等后续扩展预留。
- 看板页面的项目下拉框中，受 P4 管理的项目条目旁显示 "P4" 徽标。
- P4 项目的写路径经 p4 包装：
  - 内容覆写（卷宗小节、status、便签、`kanban/current`）前无条件 `p4 edit`；热路径保持一次 p4 调用。
  - 线程删除与重命名按 `p4 fstat` 的实时状态门控选择动词：已入 depot 用 `p4 delete`/`p4 move`，open-for-add（未提交的新增）用 `p4 revert` + 普通文件操作，未托管用纯文件操作——消解 move 语义与 new+delete 语义的混淆风险。
  - 新文件（新线程卷宗、初始化三件套）写盘后，由看板页面弹窗询问是否 `p4 add`（可批量、可拒绝；拒绝后不设补救入口，用户自行 `p4 reconcile`）。
- 写盘撞 EPERM/EACCES 时保留一次"重新检测 + 重试"保险，覆盖检测缓存陈旧的场景（非主路径）。
- p4 操作硬失败（服务器不可达、文件被他人锁定等）时返回明确错误与原因，页面给出提示，不写盘、不静默覆盖。
- 所有 p4 操作的目标路径 MUST 限制在项目 `kanban/` 子树内。

范围边界（Non-goals）：仅覆盖看板服务自身的写盘路径；Agent 直接编辑卷宗的场景不纳入（由项目自身的 prompt 指导 p4 操作）；不提供手动刷新检测的入口；不改动四条 Agent 常驻约定。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `kanban-viewer`: 新增 P4 检测与注册表缓存、项目列表徽标、写路径 p4 包装（edit / fstat 门控的 delete 与 move）、新文件弹窗问 add、p4 失败错误呈现等 Requirement。

## Impact

- 代码：`viewer/server/threads.mjs`（写路径包装）、新增 p4 封装模块、`viewer/server/registry.mjs`（注册表 `vcs` 字段）、`viewer/server/server.mjs`（路由与响应扩展）、`viewer/web/`（下拉框徽标与 add 弹窗）、`viewer/test/`（假 p4 可执行文件 shim 的测试）。
- 接口：项目列表/详情响应携带 `vcs` 字段；会创建文件的写接口响应携带 `created` 列表；新增 p4 add 接口（路径校验限制在 `kanban/` 内）。
- 外部依赖：调用用户机器上的 `p4` CLI（仅当项目检测为受管时）；无新增 npm 依赖。
- 兼容性：非 P4 项目零行为变化、零额外进程调用；注册表新增可选字段，向后兼容。
