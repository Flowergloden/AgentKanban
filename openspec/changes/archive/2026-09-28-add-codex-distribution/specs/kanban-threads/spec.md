# Spec Delta

## MODIFIED Requirements

### Requirement: 常驻约定由插件承载并条件适用

kanban 工作流的四条 Agent 常驻约定（会话校准、拐点捕获、归档蒸馏、便签人类专属）SHALL 由插件通过宿主支持的会话上下文注入形式承载，不再以项目内 AGENTS.md 为载体；Kimi 使用 systemPrompt，Codex 使用已获信任的 SessionStart additionalContext。两端 SHALL 分发同一约定正文。约定 SHALL 采用全局条件式措辞：仅当当前项目根存在 kanban/ 时适用；不存在时 Agent MUST NOT 执行任何看板相关动作，也 MUST NOT 主动创建结构。运行模式切换与保活 MUST NOT 改变线程校准、待命名线程处理、捕获确认、防抖、归档蒸馏及便签人类专属语义。

#### Scenario: 看板项目中约定生效
- **WHEN** 项目根存在 kanban/ 且宿主已正常注入约定
- **THEN** Agent 按四条约定执行校准、拐点捕获、蒸馏和便签回避，与服务 auto/persistent 模式无关

#### Scenario: 非看板项目中约定不动作
- **WHEN** 项目根不存在 kanban/
- **THEN** Agent 不执行看板约定、不主动创建结构，正常工作

#### Scenario: 项目无 AGENTS.md 约定仍生效
- **WHEN** 看板项目没有 AGENTS.md 约定但插件注入已就绪
- **THEN** Kimi 或 Codex 会话仍获得完整的四条约定，不向项目写入托管约定块

#### Scenario: 便签不进入宿主适配流程
- **WHEN** 启动 hook、活动 hook 或常驻控制执行
- **THEN** 不读取 kanban/note.md，不把便签内容注入上下文或用作控制依据
