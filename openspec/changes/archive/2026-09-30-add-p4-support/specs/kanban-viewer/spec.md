# Spec Delta

## ADDED Requirements

### Requirement: P4 受管状态检测与缓存
服务 SHALL 在项目注册与看板页面加载/切换项目时，检测该项目 `kanban/` 路径是否受 P4 管理：检测 SHALL 基于 `p4` CLI 的客户端视图映射计算（不依赖服务器可达），且 MUST 以项目根作为 p4 命令的工作目录。检测结果 SHALL 以 `vcs` 字段缓存于注册表对应项目条目，字段形状 MUST 能区分 VCS 类型（为 Git 等后续扩展预留），字段缺失表示"未检测"。`p4` CLI 不可用或路径未映射进客户端视图时 SHALL 按非 P4 项目处理，且不向用户产生错误。检测 MUST NOT 创建或修改项目 `kanban/` 结构。

#### Scenario: 注册或加载时检测并缓存
- **WHEN** 项目注册，或看板页面加载/切换到某项目
- **THEN** 服务执行受管检测，并将结果写入注册表对应项目的 `vcs` 字段

#### Scenario: p4 不可用或未映射
- **WHEN** 目标机器无 `p4` CLI，或该项目 `kanban/` 未映射进客户端视图
- **THEN** 该项目按非 P4 处理，写路径行为与既有版本一致，不向用户报错

#### Scenario: 再次加载时刷新缓存
- **WHEN** 某项目的 P4 映射关系在缓存后发生变化，页面再次加载该项目
- **THEN** 服务重新检测并更新注册表缓存字段

### Requirement: 项目列表 P4 徽标
项目列表接口响应 SHALL 携带各项目的 `vcs` 标识（未检测时缺省）。看板页面的项目下拉框 SHALL 在受 P4 管理的项目条目旁显示 "P4" 徽标；非受管或未检测的项目 MUST NOT 显示徽标。

#### Scenario: 受管项目显示徽标
- **WHEN** 某项目注册表 `vcs` 字段标记为 P4 受管
- **THEN** 项目下拉框中该条目旁显示 "P4" 徽标

#### Scenario: 未检测项目不显示徽标
- **WHEN** 某项目自服务升级后从未被加载或注册，`vcs` 字段缺失
- **THEN** 下拉框不显示徽标，待其下次加载或注册后按检测结果更新

### Requirement: P4 项目写盘前 checkout
对 `vcs` 标记为 P4 受管的项目，服务 SHALL 在覆写既有文件（卷宗小节、status、便签、`kanban/current` 等）前对目标文件执行 `p4 edit`。`p4 edit` 报告文件未纳入版本管理时 SHALL 按普通文件继续写盘；其他失败（服务器不可达、文件被锁定等）时 MUST NOT 写盘，SHALL 返回包含 p4 失败原因的明确错误，页面 SHALL 明确提示该错误而非静默忽略。

#### Scenario: checkout 后写盘成功
- **WHEN** P4 项目中对已受管且只读的卷宗保存小节修改
- **THEN** 服务先 `p4 edit` 该文件，随后写盘成功

#### Scenario: 未托管文件按普通文件写盘
- **WHEN** P4 项目中覆写一个存在但未纳入版本管理的文件（如用户拒绝 add 的新文件）
- **THEN** `p4 edit` 报告未纳入管理后，服务按普通文件写盘成功，不报错

#### Scenario: checkout 硬失败不写盘
- **WHEN** P4 项目中 `p4 edit` 因服务器不可达或文件被锁定而失败
- **THEN** 服务不写盘，返回包含 p4 失败原因的错误，页面明确提示

### Requirement: 只读写失败的检测兜底
任何 `kanban/` 写操作因目标只读（EPERM/EACCES）失败时，服务 SHALL 重新执行一次受管检测；检测结果为 P4 受管时 SHALL 按 P4 写路径重试一次并更新缓存，仍失败或非受管时 SHALL 返回明确错误。非 P4 项目的正常写路径 MUST NOT 产生任何 p4 进程调用。

#### Scenario: 缓存陈旧时自动纠正
- **WHEN** 某项目缓存为非 P4（如检测时映射尚未建立），写盘因只读失败
- **THEN** 服务重新检测，确认为 P4 受管后按 P4 写路径重试并成功，缓存随之更新

#### Scenario: 非 P4 项目保持零 p4 调用
- **WHEN** 非 P4 项目中执行任意写操作且未发生只读失败
- **THEN** 全程不产生任何 p4 进程调用

### Requirement: 线程删除的 P4 状态门控
P4 项目中删除线程时，服务 SHALL 先查询线程文件的 P4 打开状态，再按状态选择删除方式：已入 depot 的文件 SHALL 使用 `p4 delete`；open-for-add（尚未提交的新增）文件 SHALL 先 `p4 revert` 撤销 add 记录再普通删除；未托管文件 SHALL 直接普通删除。所选方式失败且无法以普通文件方式完成时 SHALL 返回明确错误。

#### Scenario: 已入 depot 的线程删除
- **WHEN** P4 项目中删除线程，其卷宗已提交入 depot
- **THEN** 服务对该卷宗执行 `p4 delete`，并移除线程目录

#### Scenario: open-for-add 的线程删除
- **WHEN** P4 项目中删除线程，其卷宗处于 open-for-add（未提交）状态
- **THEN** 服务先 `p4 revert` 撤销 add 记录，再删除文件与目录，不留孤儿 add 记录

#### Scenario: 未托管线程删除
- **WHEN** P4 项目中删除线程，其卷宗未纳入版本管理
- **THEN** 服务直接删除文件与目录，不调用 p4

### Requirement: 线程重命名的 P4 状态门控
P4 项目中重命名线程时，服务 SHALL 先查询线程文件的 P4 打开状态，再按状态选择改名方式：已入 depot 且非 open-for-add 的文件 SHALL 使用 `p4 move` 以保持 depot 历史连续；open-for-add 的文件 SHALL 先普通改名，再撤销旧路径的 add 记录并将新路径 `p4 add`；未托管文件 SHALL 直接普通改名。被改名线程为活跃线程时对 `kanban/current` 的同步写 SHALL 同样遵循写盘前 checkout 的要求。

#### Scenario: 已入 depot 的线程重命名
- **WHEN** P4 项目中重命名线程，其卷宗已提交入 depot
- **THEN** 服务使用 `p4 move` 完成改名，depot 历史保持连续

#### Scenario: open-for-add 的线程重命名
- **WHEN** P4 项目中重命名线程，其卷宗处于 open-for-add（未提交）状态
- **THEN** 服务普通改名后撤销旧路径 add 记录、将新路径 add，不留孤儿 add 记录

#### Scenario: 未托管线程重命名
- **WHEN** P4 项目中重命名线程，其卷宗未纳入版本管理
- **THEN** 服务直接普通改名，不调用 p4

### Requirement: 新文件 p4 add 弹窗询问
会创建新文件的写接口（线程创建、结构初始化等）响应 SHALL 携带本次新建的文件列表（`created`，MUST NOT 包含临时文件）。`vcs` 标记为 P4 的项目，其看板页面 SHALL 在出现新建文件后弹窗批量询问是否 `p4 add`；用户确认时 SHALL 调用 add 接口完成添加，拒绝时 MUST NOT 就同一批文件重复询问，也 MUST NOT 提供界面补救入口（用户可自行 `p4 reconcile`）。add 接口 MUST 校验目标路径位于该项目 `kanban/` 子树内，否则拒绝且不执行任何 p4 操作。

#### Scenario: 创建线程后弹窗询问 add
- **WHEN** P4 项目中创建线程，响应携带新建卷宗路径
- **THEN** 页面弹窗询问是否 `p4 add`，用户确认后该文件被纳入版本管理

#### Scenario: 拒绝后不再打扰
- **WHEN** 用户在弹窗中选择不 add
- **THEN** 页面不就同一批文件重复弹窗，其余功能不受影响

#### Scenario: add 接口拒绝越界路径
- **WHEN** add 接口收到位于项目 `kanban/` 子树之外的路径
- **THEN** 接口拒绝且不执行任何 p4 操作

### Requirement: P4 调用约束
服务的所有 p4 调用 MUST 以目标项目根作为工作目录，操作目标 MUST 限制在该项目 `kanban/` 子树内的路径。服务 MUST NOT 执行 `p4 submit`，也 MUST NOT 改动用户已有的 changelist 归属；服务打开的文件 SHALL 留在默认 changelist，由用户自行提交。

#### Scenario: 不替用户提交
- **WHEN** 服务完成任意 p4 包装写操作
- **THEN** 目标文件仅以打开状态留在默认 changelist，不发生 submit
