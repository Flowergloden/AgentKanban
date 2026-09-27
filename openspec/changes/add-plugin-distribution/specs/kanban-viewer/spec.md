# Spec Delta

## REMOVED Requirements

### Requirement: kanban 结构初始化与自动补全

**Reason**：插件全局常驻后，SessionStart hook 自动初始化会话所在项目的副作用从单项目放大到所有项目，会在无关仓库中创建 `kanban/` 目录造成污染；初始化时机改为惰性补齐。

**Migration**：初始化接口本身保留不变；`kanban/` 结构的创建时机由"会话启动时自动初始化"改为"看板页面加载项目或任意写操作时自动补齐"，由新需求「kanban 结构初始化与惰性补齐」承载。使用方无需迁移数据。

## ADDED Requirements

### Requirement: kanban 结构初始化与惰性补齐

服务 SHALL 提供初始化接口：对任意项目根路径创建看板所需的最小结构——`kanban/`、`kanban/threads/`、`kanban/templates/` 目录、`kanban/templates/thread.md` 卷宗模板、`kanban/current`（空文件）与 `kanban/note.md` 全局便签（带"仅供人类阅读"说明头注释）；初始化 MUST 幂等：已存在的目录与文件不得被修改或覆盖。项目自有模板存在时 MUST 优先使用；模板文件缺失时服务 SHALL 以内置默认模板兜底创建。插件 SessionStart hook MUST NOT 自动调用初始化接口初始化会话所在项目：`kanban/` 结构 SHALL 惰性补齐，仅在写操作或看板页面加载项目时创建。看板页面加载项目（含切换项目）时 SHALL 自动调用初始化接口；服务不支持该接口时页面 MUST 正常降级（跳过初始化，其余功能不受影响）。线程创建、活跃切换等写操作在结构缺失时 SHALL 自动补齐结构后完成，不再返回"缺少目录/模板"类错误。

#### Scenario: 初始化空白项目

- **WHEN** 对一个不存在 `kanban/` 的项目调用初始化接口
- **THEN** `kanban/`、`kanban/threads/`、`kanban/templates/` 目录被创建，`kanban/templates/thread.md`、空的 `kanban/current` 与含说明头的 `kanban/note.md` 被创建，接口返回本次新建的路径列表

#### Scenario: 重复初始化幂等

- **WHEN** 对已具备完整结构（含项目自定义模板与非空 `kanban/current`）的项目再次调用初始化接口
- **THEN** 不创建、不修改任何已有路径与文件，返回空的新建列表

#### Scenario: 会话启动不初始化项目

- **WHEN** 某项目的 kimi-code 会话启动，插件 SessionStart hook 拉起或复用服务并完成项目注册，且该项目不存在 `kanban/` 结构
- **THEN** 该项目的文件系统不发生任何变化，`kanban/` 结构不会被创建

#### Scenario: 页面加载自动初始化

- **WHEN** 用户打开看板页面或切换到下拉中的另一项目，且该项目缺少 kanban 结构
- **THEN** 页面自动调用初始化接口完成补全，并向用户给出"已自动初始化"的提示，后续新建线程、活跃切换等操作不受阻

#### Scenario: 旧版服务降级

- **WHEN** 页面连接的是不支持初始化接口的旧版看板服务
- **THEN** 初始化调用失败被静默跳过，页面其余功能照常工作

#### Scenario: 写操作缺结构自动补齐

- **WHEN** 项目缺少 kanban 结构时发起线程创建或活跃线程切换
- **THEN** 服务先自动补齐缺失的目录与文件，再完成操作；线程创建使用项目自有模板（缺失则用内置默认模板）生成卷宗

### Requirement: 插件向所有项目会话注入常驻约定

插件 SHALL 在 manifest 中通过 `systemPromptPath` 声明插件目录内的约定文本文件，使 kanban 常驻约定随插件启用注入所有项目的会话系统提示词；约定文本 SHALL 随插件版本一同分发与更新。

#### Scenario: 新会话获得约定注入

- **WHEN** 插件已安装并启用，用户开启或恢复任意项目的会话
- **THEN** 该会话的系统提示词中包含插件约定文件的内容

#### Scenario: 约定随插件更新分发

- **WHEN** 用户将插件更新到新版本
- **THEN** 此后新会话注入的是新版本插件内的约定文本
