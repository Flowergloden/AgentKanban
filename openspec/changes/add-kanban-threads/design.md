# Design

## Context

项目为空仓库，仅有已初始化的 `openspec/`（spec-driven schema，无 specs/changes）。已验证的环境事实：

- OpenSpec CLI 1.13.1；`openspec-archive-change` 技能在归档流程中会主动读取 `openspec/config.yaml` 的 `operations.archive.guidance` 作为 advisory 输入，读不到时跳过且不阻塞归档
- `AGENTS.md` 每次会话常驻加载；`openspec/config.yaml` 的 `context` 字段仅在 OpenSpec 工作流运行时加载
- spec-driven schema 的 design.md 模板要求 Decisions 记录原因与备选方案，但 design 为条件性工件，简单 change 可能不创建

## Goals / Non-Goals

**Goals:**

- 以纯文件形式承载跨会话的笼统目标（线程），同时服务人类读者与 Agent 读者
- 单一事实来源：同一份文件，人类直接阅读，Agent 直接读取，不存在同步问题
- 零代码、零外部依赖；不修改 OpenSpec 技能文件与 CLI

**Non-Goals:**

- 不实现 CLI / Web 渲染工具（后续变更再议）
- 不做生命周期状态的自动推导（MVP 阶段流转全手动）
- 不替代或改动 OpenSpec 的 change 层语义

## Decisions

### D1: 线程层放在独立目录 `kanban/`，按名字引用 change

- **备选 A**：放入 `openspec/threads/`——所有项目上下文一个屋顶，但 OpenSpec CLI 不认识该目录，未来版本的 validate/archive 行为可能与之冲突，且职责混杂
- **选定 B**：独立目录，以 change 名字松耦合引用——职责分离干净；将来即使替换底层工作流，线程层不受影响

### D2: 线程与 change 是 1:N 包含关系，而非成熟关系

探索阶段曾假设"线程成熟后变成 change"。用户明确纠正：线程是笼统目标（实现某模块/原型）的容器，change 是容器内的一次任务；一条线程可能只有一个 change，也可能拆成多个。线程完成由用户判断"目标达成"，不从 change 状态自动推导。

### D3: archive 蒸馏走 `operations.archive.guidance` + AGENTS.md 双 prompt 层

- **备选 A**：直接修改 `openspec-archive-change` 技能文件，加入记录步骤——时机最精准，但违背"避免修改第三方完整解决方案"的原则，技能升级即丢失修改
- **备选 B**：仅靠 AGENTS.md 常驻指令——可行，但依赖 Agent 在归档流程中记起约定，时机不精准
- **选定 C**：`config.yaml` 的 `operations.archive.guidance`（工作流内精准时机，advisory 性质保证不阻塞归档）+ AGENTS.md 常驻约定（老版本技能读不到 guidance 时兜底）

### D4: 非归档拐点由 AGENTS.md 提示 Agent 询问用户

方向被否决、想法验证出结论等时刻没有 archive 事件可挂钩。全自动记录不可靠且打扰心流；改为 Agent 在明确拐点询问用户"要记入卷宗吗"，并带防抖约束：不每轮问、用户拒绝后不追问同一事件。

### D5: 生命周期四态（立项/规划/实现/完成）手动流转

- **备选**：从关联 change 的状态自动推导——需要代码实现，且"目标是否达成"本质是人的判断，自动推导容易产生错误信号
- **选定**：MVP 阶段完全手动，操作文档说明流转方法；自动推导留给将来工具化阶段

## Risks / Trade-offs

- [Agent 不遵守 AGENTS.md 约定] → 约定写得具体、可检查（明确的触发条件与动作）；guidance 层在工作流内提供二次提示
- [guidance 是 advisory，技能可声明不适用而跳过] → AGENTS.md 兜底；该性质同时保证归档永不被线程需求阻塞，可接受
- [纯手动维护导致卷宗腐化] → 卷宗结构最小化（仅三个必备内容小节）；会话开始的校准动作顺带暴露滞后并顺势更新
- [explore 阶段的对话决策无工件载体，仍有遗漏] → 已知边界，由 D4 的拐点询问兜底，不追求全覆盖
