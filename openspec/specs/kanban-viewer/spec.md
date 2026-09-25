# kanban-viewer Specification

## Purpose

为一个或多个项目的看板（`kanban/`）提供当前 active thread 的可视化页面：本地 Web 服务随 kimi-code 会话自动生灭，前端展示 `thread.md` 原文，用户无需手动维护任何后台进程或终端窗口。

## Requirements

### Requirement: 服务随会话自动拉起且拉起幂等

当任意 kimi-code 会话启动（startup 或 resume）时，插件 hook SHALL 确保看板服务处于运行状态：未运行则拉起一个无终端窗口的本地服务进程，已运行则复用，MUST NOT 产生重复的服务进程。服务 SHALL 仅监听本地回环地址（127.0.0.1）。

#### Scenario: 首个会话拉起服务

- **WHEN** 服务未运行时，任意项目的 kimi-code 会话启动（新建或恢复历史会话）
- **THEN** 看板服务被自动拉起，且能通过其健康检查接口访问，全程不出现终端窗口

#### Scenario: 重复拉起被抑制

- **WHEN** 服务已在运行时，另一个会话启动
- **THEN** 不启动新的服务进程，仍只有一个服务进程在监听

### Requirement: 服务随会话结束自动退出

服务 SHALL 依赖会话心跳维持存活；当最近一次心跳距今超过 180 秒时，服务 SHALL 自行退出，不残留进程。会话心跳由插件 hook 上报，服务 MUST NOT 依赖 `SessionEnd` 事件。

#### Scenario: 心跳停止后服务退出

- **WHEN** 所有 kimi-code 会话均已结束，最后一条心跳距今超过 180 秒
- **THEN** 服务进程自动退出，本地端口被释放

#### Scenario: 会话存活期间服务不退出

- **WHEN** 至少一个会话存活并按约 60 秒间隔上报心跳
- **THEN** 服务保持运行，不发生自动退出

### Requirement: 多项目注册表

服务 SHALL 维护一份项目注册表，记录各项目根路径及其最近活跃时间（lastSeen）；项目根路径来源于 hook 上报的会话 `cwd`。注册表 SHALL 持久化到用户级目录，服务重启后注册表内容仍然可用。

#### Scenario: 会话所在项目被注册

- **WHEN** 某项目下的会话启动或上报心跳
- **THEN** 该项目根路径出现在注册表中，lastSeen 被刷新为当前时间

#### Scenario: 注册表在服务重启后保留

- **WHEN** 服务退出后被再次拉起
- **THEN** 此前注册过的项目列表仍然完整可查

### Requirement: active thread 查询接口

服务 SHALL 提供按项目根路径查询 active thread 的接口：读取该项目的 `kanban/current` 获得活跃线程标识，并返回对应 `kanban/threads/<标识>/thread.md` 的完整原文。服务对 `kanban/` 目录 MUST 只读。无活跃线程或数据缺失时 SHALL 返回明确的状态标识而非异常。

#### Scenario: 查询到活跃线程

- **WHEN** 项目 P 的 `kanban/current` 指向存在的线程目录
- **THEN** 接口返回该线程的标识与 `thread.md` 原文，原文内容一字不改

#### Scenario: 无活跃线程

- **WHEN** 项目 P 的 `kanban/current` 为空或不存在
- **THEN** 接口返回"无活跃线程"的明确状态，不产生错误

#### Scenario: 活跃线程指向缺失的卷宗

- **WHEN** `kanban/current` 指向的线程目录或 `thread.md` 不存在
- **THEN** 接口返回"卷宗缺失"的明确状态，服务本身不崩溃

### Requirement: 看板页面展示线程原文

前端页面 SHALL 展示指定项目 active thread 的 `thread.md` 原文（保留原始 Markdown 文本，不做渲染加工）。页面 SHALL 支持以 URL 参数指定项目根路径；未指定时 SHALL 展示注册表中最近活跃的项目，并提供在已注册项目间切换的入口。无活跃线程时页面 SHALL 显示明确提示。

#### Scenario: 按 URL 参数定位项目

- **WHEN** 用户以带项目根路径参数的 URL 打开页面
- **THEN** 页面直接显示该项目 active thread 的原文

#### Scenario: 无参数时落到最近项目

- **WHEN** 用户以不带参数的 URL 打开页面，且注册表非空
- **THEN** 页面显示 lastSeen 最近项目的 active thread，并可切换到其他已注册项目

#### Scenario: 项目无活跃线程时的提示

- **WHEN** 被显示的项目没有活跃线程
- **THEN** 页面显示"当前无活跃线程"的明确提示，而非空白或报错

### Requirement: 打开看板入口

插件 SHALL 注册 `/kanban:open` 斜杠命令，引导 Agent 在系统默认浏览器中打开携带当前项目根路径参数的看板页面 URL。插件 SHALL 同时提供等价的 skill 入口（桌面端不派发插件 commands，skill 为桌面端可用入口）。

#### Scenario: 打开当前项目看板

- **WHEN** 用户在某项目的会话中输入 `/kanban:open`（CLI）或触发 kanban-open skill（桌面端）
- **THEN** Agent 打开携带该项目根路径参数的看板 URL，浏览器中呈现该项目 active thread 页面
