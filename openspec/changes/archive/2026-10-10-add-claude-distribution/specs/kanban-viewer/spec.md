# Spec Delta

## MODIFIED Requirements

### Requirement: 服务随会话自动拉起且拉起幂等

当已启用且必要 hooks 已获信任的 Kimi、Codex 或 Claude Code 会话启动（startup 或 resume）时，插件 hook SHALL 确保本地看板服务运行；服务空闲退出后的有效会话活动或打开入口 SHALL 能重新启动服务。服务 SHALL 仅监听 127.0.0.1，后台启动 MUST NOT 出现终端窗口，进程工作目录 MUST 位于插件托管目录之外。并发启动与升级 MUST 串行协调并复查服务状态，不产生重复常驻进程。协议兼容且服务版本相同或更新时 SHALL 复用；本地版本更新且协议兼容时 SHALL 协调升级并保留运行模式与注册表。协议不兼容时 MUST NOT 自动停止现有服务。无协议元数据的旧服务 SHALL 在旧接口可用时降级复用普通功能并提示迁移，MUST NOT 声称新模式控制可用；旧服务不支持退出时 MUST NOT 强杀。完整多宿主保障以各方支持新协议为前提。

#### Scenario: 首个会话拉起服务
- **WHEN** 服务未运行且 Kimi、Codex 或 Claude Code 的有效启动 hook 执行
- **THEN** 服务后台启动、健康检查可达，启动注册不创建项目 kanban 结构

#### Scenario: 重复拉起被抑制
- **WHEN** 多个宿主同时确保服务运行
- **THEN** 协调后只有一个服务进程持有监听端口，其余方复用该服务

#### Scenario: 服务运行不锁定插件托管目录
- **WHEN** 服务运行中覆盖安装插件
- **THEN** 服务工作目录不在托管目录中，安装不因该工作目录被占用而失败

#### Scenario: 版本不一致时换代
- **WHEN** 本地版本更新、协议兼容且运行中服务为常驻模式
- **THEN** 协调退出旧服务并启动新版，健康检查报告新版本、常驻模式，注册表保留

#### Scenario: 旧启动器复用新协议服务
- **WHEN** 支持新协议的较旧插件启动，运行中的较新服务协议兼容
- **THEN** 直接复用，MUST NOT 请求降级替换

#### Scenario: 旧版服务不支持主动退出时退化复用
- **WHEN** 运行中的旧服务没有协议元数据或不支持退出，但注册与打开接口可用
- **THEN** 普通打开降级复用、说明迁移要求，不强杀或制造重复进程；常驻控制明确报告不支持

#### Scenario: 协议或端口冲突
- **WHEN** 端口被非看板服务占用，或当前看板服务协议与客户端不兼容
- **THEN** 报告冲突及处理指引，不发送自动退出请求，不误报服务已就绪

#### Scenario: 换代期间模式切换
- **WHEN** 用户在升级换代期间请求改变运行模式
- **THEN** 请求被串行处理或返回可重试状态，不出现已成功确认的模式变更被升级静默覆盖

#### Scenario: Claude Code 非启动来源不拉起服务
- **WHEN** Claude Code SessionStart 收到 clear、compact 或 fork 来源
- **THEN** hook 仅输出约定上下文，不因该来源额外执行服务确保或项目注册

### Requirement: 服务随会话结束自动退出

默认 auto 模式 SHALL 以有效活动维持存活，活动包含会话注册、Codex 与 Claude Code 的用户提交及工具完成事件、Kimi 心跳、成功看板业务交互和可见页面续期。连续超过 180 秒无活动后 SHALL 在下一次不超过 30 秒间隔的清理检查中退出；persistent 模式 MUST NOT 因空闲退出。系统 MUST NOT 依赖 SessionEnd 或虚构的 SessionHeartbeat 保证 Codex 或 Claude Code 保活，也不保证闲置聊天或隐藏页面仍然存活。页面 SHALL 仅在可见时约每 60 秒续期，重新可见时立即尝试；有效活动 hook SHALL 有界执行、节流且在服务停止后可重新启动，失败不阻塞用户原任务。本插件服务控制及纯状态/健康探测所触发的工具完成事件 MUST NOT 作为自动恢复或保活信号。

#### Scenario: 心跳停止后服务退出
- **WHEN** auto 模式下所有有效活动停止超过 180 秒
- **THEN** 服务在下次清理检查中退出，即使 Codex 或 Claude Code 闲置聊天尚未关闭

#### Scenario: 会话存活期间服务不退出
- **WHEN** 至少一个会话或可见页面持续在 180 秒以内发送有效活动
- **THEN** 服务保持运行，Kimi 原有约 60 秒心跳仍可作为有效活动

#### Scenario: 页面隐藏后不独自保活
- **WHEN** 页面变为隐藏且没有其他活动来源
- **THEN** 页面停止定时续期，auto 服务按空闲期限退出

#### Scenario: 后续会话活动恢复服务
- **WHEN** 服务已空闲退出，可信活动 hook 收到后续用户提交或工具完成事件
- **THEN** 服务重新后台启动并注册项目，不只向已经不存在的服务发送心跳

#### Scenario: 停止操作不被自身事件抵消
- **WHEN** Agent 执行本插件 stop 或只读状态探测，随后触发工具完成 hook
- **THEN** 该事件不重新启动已停止服务，也不刷新存活期限；后续独立的有效任务活动仍可恢复

#### Scenario: 页面无法自行恢复本地进程
- **WHEN** 页面休眠后恢复可见但服务已经退出
- **THEN** 页面显示通过本地打开入口恢复的提示，不宣称 HTTP 重试已启动进程

#### Scenario: 常驻模式不受空闲期限限制
- **WHEN** persistent 服务无任何活动超过 180 秒并经过清理检查
- **THEN** 服务继续运行，不依赖会话或浏览器存在

#### Scenario: Claude Code 活动 hook 不阻塞回合
- **WHEN** Claude Code 用户提交或工具完成触发活动 hook
- **THEN** hook 以后台方式执行并受节流约束，服务不可达时不延迟或中断用户回合

### Requirement: 打开看板入口

Kimi 插件 SHALL 保留 /kanban:open 及等价 skill；Codex 与 Claude Code SHALL 提供宿主可发现的打开 skill，不依赖 Kimi 命令派发或安装路径。打开入口 SHALL 从明确项目根构造 URL 编码参数，先确保服务可用，再在默认浏览器打开页面；MUST NOT 将插件目录当项目根。普通打开 SHALL 保留运行中服务的模式，服务未运行时默认 auto。服务无法就绪时 SHALL 报告原因而非声称成功打开可用看板。

#### Scenario: 打开当前项目看板
- **WHEN** 用户通过 Kimi 命令或任一宿主的打开 skill 打开看板
- **THEN** 服务就绪后浏览器访问当前项目的编码 URL；路径含空格、中文和 Windows 分隔符仍正确

#### Scenario: 冷启动和常驻复用
- **WHEN** 用户打开看板，服务未运行或已为 persistent
- **THEN** 未运行时启动 auto，已为 persistent 时保持模式并复用

### Requirement: 插件向所有项目会话注入常驻约定

约定 SHALL 以共享正文随插件发布更新。Kimi SHALL 保留 systemPromptPath；Codex SHALL 通过已启用且已信任的 SessionStart hook 将正文作为 additionalContext 注入，覆盖 startup/resume 和 compact 后的上下文恢复。Claude Code SHALL 通过已启用插件的 SessionStart hook 将同一正文作为 additionalContext 注入，覆盖 startup、resume、clear、compact 与 fork 来源。服务启动失败 MUST NOT 阻止独立的约定输出，诊断 MUST NOT 污染 JSON stdout。未获信任的 hook MUST NOT 被绕过，文档 MUST 说明此时自动启动与注入不可视为已生效。各宿主 MUST 保留相同的项目存在性守卫与四条约定。

#### Scenario: 新会话获得约定注入
- **WHEN** 插件及必要 hooks 已启用和获信任，用户新建或恢复会话
- **THEN** 对应宿主的会话上下文包含共享约定正文，无需修改项目 AGENTS.md 或 CLAUDE.md

#### Scenario: 约定随插件更新分发
- **WHEN** 更新插件并完成所需信任审核后开启新会话
- **THEN** 注入的是新版插件约定正文

#### Scenario: 压缩后恢复约定
- **WHEN** Codex 或 Claude Code SessionStart 收到 compact 来源
- **THEN** 新上下文恢复共享约定，不额外要求仅因压缩重复进行用户校准

#### Scenario: Claude Code 清空上下文后恢复约定
- **WHEN** Claude Code SessionStart 收到 clear 或 fork 来源
- **THEN** 新上下文包含共享约定正文

#### Scenario: 服务启动失败不吞掉约定
- **WHEN** 看板端口冲突导致启动失败但 hook 可正常执行
- **THEN** hook 仍输出合法约定上下文，服务错误写入诊断通道，不阻塞用户原任务
