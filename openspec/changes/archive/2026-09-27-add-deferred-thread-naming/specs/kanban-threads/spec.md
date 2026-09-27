# Spec Delta

## MODIFIED Requirements

### Requirement: Agent 会话启动时读取当前线程

当 `kanban/current` 指向某条线程时，Agent SHALL 在会话开始阶段读取该线程的卷宗，向用户复述其对当前状态的理解并与用户校准，再开始具体工作。若活跃线程的 slug 精确命中保留标记值 `unnamed-pending`（待命名状态），Agent SHALL 在校准复述前自动完成命名：据卷宗标题（必要时参考 `## 目标` 小节）生成英文 kebab-case slug，并调用看板服务的线程重命名接口完成改名；命名 MUST NOT 询问用户确认，且仅对当前活跃线程执行；命名结果 SHALL 在校准复述中一并报告。

#### Scenario: 存在活跃线程

- **WHEN** 用户开启新会话且 `kanban/current` 指向线程 T
- **THEN** Agent 在正式工作前复述线程 T 的目标、当前进展与下一步，并请用户确认或纠正

#### Scenario: 活跃线程处于待命名状态

- **WHEN** 会话开始，且活跃线程的 slug 精确等于 `unnamed-pending`
- **THEN** Agent 先自动据卷宗标题生成英文 kebab-case slug 并调用重命名接口完成命名，随后在校准复述中报告命名结果，全程不询问用户

#### Scenario: 非活跃的待命名线程不处理

- **WHEN** 存在 slug 为 `unnamed-pending` 的线程，但它不是当前活跃线程
- **THEN** Agent 不对其执行命名，留待其被激活后的会话校准处理

#### Scenario: 无活跃线程

- **WHEN** `kanban/current` 为空或不存在
- **THEN** Agent 不执行线程校准，正常工作
