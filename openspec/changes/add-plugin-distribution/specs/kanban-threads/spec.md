# Spec Delta

## MODIFIED Requirements

### Requirement: 归档后的非侵入式蒸馏

当一个属于某线程的 OpenSpec change 完成归档后，Agent SHALL 从该 change 的工件（proposal、design、tasks）蒸馏出一小段总结，追加到所属线程卷宗的 `## 已完成的工作`。该行为 SHALL 通过 kanban 插件注入的常驻约定提示；项目 `openspec/config.yaml` 的 `operations.archive.guidance` 配置项 SHALL 作为可选的增强提示保留，MUST NOT 修改 OpenSpec 技能文件或 CLI。

#### Scenario: 归档属于线程的 change

- **WHEN** `openspec-archive-change` 流程完成，且被归档的 change 出现在某线程的 `## Changes` 列表中
- **THEN** Agent 将该 change 的动机、关键决定与完成情况蒸馏为一小段文字，追加到该线程的 `## 已完成的工作`

#### Scenario: 归档不属于任何线程的 change

- **WHEN** 归档的 change 不属于任何线程
- **THEN** Agent 不执行蒸馏动作

## ADDED Requirements

### Requirement: 常驻约定由插件承载并条件适用

kanban 工作流的四条 Agent 常驻约定（会话校准、拐点捕获、归档蒸馏、便签人类专属）SHALL 由 kanban 插件以 systemPrompt 注入形式承载，而不再以项目内 `AGENTS.md` 为载体。约定文本 SHALL 采用全局条件式措辞：仅当当前项目根目录存在 `kanban/` 目录时约定适用；不存在时 Agent MUST NOT 执行任何看板相关动作，也 MUST NOT 主动创建 `kanban/` 结构。

#### Scenario: 看板项目中约定生效

- **WHEN** 会话所在项目根目录存在 `kanban/` 目录
- **THEN** 插件注入的四条常驻约定适用，Agent 按约定执行会话校准、拐点捕获、归档蒸馏与便签回避

#### Scenario: 非看板项目中约定不动作

- **WHEN** 会话所在项目根目录不存在 `kanban/` 目录
- **THEN** Agent 不执行任何看板约定动作，不创建 `kanban/` 结构，正常工作

#### Scenario: 项目无 AGENTS.md 约定仍生效

- **WHEN** 看板项目的仓库中不存在 `AGENTS.md` 或其中不包含 kanban 约定
- **THEN** 四条常驻约定仍通过插件 systemPrompt 对该项目的会话生效
