# Spec Delta

## MODIFIED Requirements

### Requirement: 线程创建与删除接口

服务 SHALL 提供线程创建接口：请求携带线程标题；服务 SHALL 分配下一个未用的序号 id、生成 slug（允许调用方指定），套用卷宗模板生成卷宗（status 默认为 `立项`，项目自有 `kanban/templates/thread.md` 存在时优先使用，缺失时以内置默认模板兜底）。slug 未指定时 SHALL 从标题自动生成：标题经 ASCII 化后无有效产出（如纯非英文标题）时，MUST 以保留标记值 `unnamed-pending` 占位，表示"待命名"，MUST NOT 再 fallback 为 `thread` 等固定词；标记值占位 SHALL 豁免 slug 冲突检查，多条待命名线程以序号前缀区分共存。`unnamed-pending` SHALL 为保留字：调用方显式以其作为创建 slug 时 MUST 返回错误且不创建线程。除标记值占位外，id/slug 冲突时 MUST 返回错误而非覆盖现有线程。创建所需目录结构缺失时 SHALL 自动补齐而非报错。服务 SHALL 提供线程删除接口：删除整个线程目录；目录不存在时返回明确状态；若被删除的是当前活跃线程，SHALL 同时清空 `kanban/current`。删除为真删，不提供回收站。

#### Scenario: 创建线程

- **WHEN** 以标题"用户认证"创建线程，且已有最大序号为 `0002`
- **THEN** 新线程目录为 `0003-<slug>`，卷宗由模板生成、标题已填写、status 为 `立项`

#### Scenario: 非英文标题创建为待命名线程

- **WHEN** 以中文标题"细节优化"创建线程且 slug 留空
- **THEN** 新线程目录为 `0003-unnamed-pending`（序号取下一未用值），创建成功不报 slug 冲突

#### Scenario: 多条待命名线程共存

- **WHEN** 已存在 `0003-unnamed-pending`，再以另一中文标题创建线程且 slug 留空
- **THEN** 新线程目录为 `0004-unnamed-pending`，两条线程共存，不因 slug 相同而报错

#### Scenario: 保留字拒绝显式使用

- **WHEN** 调用方创建线程时显式指定 slug 为 `unnamed-pending`
- **THEN** 接口返回错误，不创建线程

#### Scenario: 空白项目直接创建线程

- **WHEN** 在一个没有任何 kanban 结构的项目中直接发起线程创建
- **THEN** 服务自动创建 `kanban/` 结构与模板后完成线程创建，返回新线程标识，不再返回"缺少目录/模板"错误

#### Scenario: 项目自有模板缺失时使用内置模板

- **WHEN** 项目的 `kanban/templates/thread.md` 不存在时发起线程创建
- **THEN** 服务以内置默认模板生成卷宗（首行标题、`status: 立项`、四个必备小节齐全），线程正常创建

#### Scenario: 删除普通线程

- **WHEN** 删除一条非活跃线程
- **THEN** 其线程目录被移除，`kanban/current` 不受影响

#### Scenario: 删除活跃线程

- **WHEN** 删除的线程正是 `kanban/current` 指向的活跃线程
- **THEN** 线程目录被移除，且 `kanban/current` 被清空

## ADDED Requirements

### Requirement: 线程重命名接口

服务 SHALL 提供线程重命名接口：请求携带线程标识与新 slug。新 slug MUST 为 kebab-case（小写字母、数字、连字符）且 MUST NOT 为保留字 `unnamed-pending`，违反时返回错误且不改动任何文件。新 slug 与其他现有线程的 slug 冲突时 MUST 返回错误且不改动。校验通过时 SHALL 将线程目录更名为`序号-新slug`（序号部分保持不变），卷宗内容一字不改；被改名线程为当前活跃线程时 SHALL 同步将 `kanban/current` 更新为新标识，非活跃线程时 MUST NOT 改动 `kanban/current`。线程不存在时返回明确状态。

#### Scenario: 重命名待命名线程

- **WHEN** 将线程 `0003-unnamed-pending` 重命名为 `ergonomic-improvements`
- **THEN** 线程目录变为 `0003-ergonomic-improvements`，序号 `0003` 不变，`thread.md` 内容不变

#### Scenario: 重命名活跃线程同步 current

- **WHEN** 被重命名的线程正是 `kanban/current` 指向的活跃线程
- **THEN** 目录更名后 `kanban/current` 内容更新为新标识

#### Scenario: 重命名非活跃线程不动 current

- **WHEN** 被重命名的线程不是活跃线程
- **THEN** 目录更名，`kanban/current` 内容保持不变

#### Scenario: 新 slug 非法或为保留字

- **WHEN** 新 slug 不是 kebab-case，或等于保留字 `unnamed-pending`
- **THEN** 接口返回错误，目录与 `kanban/current` 均不变化

#### Scenario: 新 slug 冲突

- **WHEN** 新 slug 已被另一条线程占用
- **THEN** 接口返回错误，目录与 `kanban/current` 均不变化
