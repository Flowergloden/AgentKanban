# Tasks

## 1. 真实 P4 行为验证（先行，在 VibeRPG 环境实测）

- [x] 1.1 实测 `p4 where kanban/...` 在服务器不可达时是否仍为纯客户端计算并正确反映映射；验证：断网/VPN 断开状态下执行，输出仍给出映射结果
- [x] 1.2 实测 `p4 edit` 对 open-for-add 文件的退出码与输出；验证：对一个尚未 submit 的 add 文件执行，确认幂等成功
- [x] 1.3 实测 `p4 move` 对 open-for-edit 源文件、目标目录不存在、目标已存在三种情形的行为；验证：逐情形执行并记录结果，与预期不符的分支按 design.md 决策 4 落回普通文件操作
- [x] 1.4 实测 `p4 delete` 对 open-for-edit 文件是自动转 delete 还是报错；验证：执行并记录结果
- [x] 1.5 实测 `p4 revert` 对"文件已不在旧路径"的 open-for-add 记录是否仅撤销记录；验证：执行并记录结果

## 2. p4 封装模块（viewer/server/vcs.mjs）

- [x] 2.1 实现 spawn 基础层（`cwd` 为项目根、约 10 秒超时、PATH 无 `p4` 时判定不可用）与三态结果分类（ok / unmanaged / hard-fail 携带原因）；验证：单元测试覆盖分类逻辑
- [x] 2.2 实现 `detect(root)`（`p4 -V` + `p4 where kanban/...`）；验证：shim 测试覆盖映射、未映射、无 CLI 三分支
- [x] 2.3 实现 `edit`/`add`/`del`/`move`/`fstat`/`revert` 包装，fstat 解析出三态（已入 depot 非 add / open-for-add / 未托管）；验证：shim 测试各动词成功、unmanaged、hard-fail 路径

## 3. 注册表与检测接线

- [x] 3.1 `registry.mjs` 项目条目支持可选 `vcs` 字段（`{ type, checkedAt }`），缺省兼容旧数据；验证：加载不含该字段的旧注册表数据不报错
- [x] 3.2 项目注册与 `/api/init`（页面加载/切换）时执行检测并刷新缓存字段，检测失败/不可用按非 P4 处理且不报错；验证：接口测试 + shim 覆盖缓存写入与刷新

## 4. 写路径包装（viewer/server/threads.mjs）

- [x] 4.1 `atomicWrite` 外层加 checkout 包装：`vcs=p4` 时覆写前先 `p4 edit`，unmanaged 落回普通写盘，hard-fail 不写盘并返回携带原因的明确错误；验证：shim 测试三种结果
- [x] 4.2 写盘撞 EPERM/EACCES 时的兜底阶梯：重新检测一次 → 翻转为 P4 则按 P4 路径重试一次 → 仍失败返回明确错误；验证：模拟"缓存非 P4 + 文件只读"的测试用例通过，且非 P4 项目正常写路径零 p4 调用
- [x] 4.3 `create` 与 `ensureLayout` 收集本次新建文件相对路径（排除 `*.tmp`），写接口响应携带 `created` 列表；验证：接口测试断言 created 内容
- [x] 4.4 `remove` 按 fstat 三态门控：已入 depot → `p4 delete`；open-for-add → `p4 revert` + 普通删除；未托管 → 纯文件删除；验证：三态 shim 测试
- [x] 4.5 `rename` 按 fstat 三态门控：已入 depot → `p4 move`；open-for-add → FS 改名 + revert 旧路径 + add 新路径；未托管 → 纯 FS 改名；活跃线程改名时 `kanban/current` 同步写走 4.1 的 checkout 包装；验证：三态 shim 测试

## 5. 接口与前端

- [x] 5.1 项目列表接口响应携带各项目 `vcs` 标识，看板页面项目下拉框在 P4 受管项目条目旁显示 "P4" 徽标（未检测/非受管不显示）；验证：接口测试 + 页面人工确认
- [x] 5.2 新增 `POST /api/vcs/add` 接口：逐条校验解析后的绝对路径位于该项目 `kanban/` 子树内，越界拒绝且不执行任何 p4 操作；验证：接口测试含越界用例
- [x] 5.3 前端在 `vcs.type === "p4"` 且响应 `created` 非空时弹模态框批量列出文件（「p4 add」/「不 add」），确认调 add 接口，拒绝不就同一批文件重复询问；p4 hard-fail 错误在页面明确提示；验证：页面人工确认完整流程

## 6. 回归与发布

- [x] 6.1 既有测试全套通过且新增测试全绿；验证：`npm test`（或现有测试命令）全绿
- [x] 6.2 VibeRPG 真实 P4 环境端到端验收：小节保存、status 流转、活跃切换、便签保存、线程创建/重命名/删除、弹窗 add 与拒绝路径、服务器不可达时的错误提示；验证：逐项手动实测
- [x] 6.3 `service.json` 与 `kimi.plugin.json` 提升次版本号并完成插件目录同步；验证：release 流程跑通，健康检查版本与 manifest 一致
