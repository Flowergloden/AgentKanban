# Spec Delta

## ADDED Requirements

### Requirement: kanban 结构初始化与自动补全

服务 SHALL 提供初始化接口：对任意项目根路径创建看板所需的最小结构——`kanban/`、`kanban/threads/`、`kanban/templates/` 目录、`kanban/templates/thread.md` 卷宗模板与 `kanban/current`（空文件）；初始化 MUST 幂等：已存在的目录与文件不得被修改或覆盖。项目自有模板存在时 MUST 优先使用；模板文件缺失时服务 SHALL 以内置默认模板兜底创建。插件 SessionStart hook SHALL 在服务就绪后自动调用初始化接口初始化会话所在项目。看板页面加载项目（含切换项目）时 SHALL 自动调用初始化接口；服务不支持该接口时页面 MUST 正常降级（跳过初始化，其余功能不受影响）。线程创建、活跃切换等写操作在结构缺失时 SHALL 自动补齐结构后完成，不再返回"缺少目录/模板"类错误。

#### Scenario: 初始化空白项目

- **WHEN** 对一个不存在 `kanban/` 的项目调用初始化接口
- **THEN** `kanban/`、`kanban/threads/`、`kanban/templates/` 目录被创建，`kanban/templates/thread.md` 与空的 `kanban/current` 被创建，接口返回本次新建的路径列表

#### Scenario: 重复初始化幂等

- **WHEN** 对已具备完整结构（含项目自定义模板与非空 `kanban/current`）的项目再次调用初始化接口
- **THEN** 不创建、不修改任何已有路径与文件，返回空的新建列表

#### Scenario: 会话启动自动初始化

- **WHEN** 某项目的 kimi-code 会话启动，插件 SessionStart hook 拉起或复用服务并完成项目注册
- **THEN** 该项目的 kanban 最小结构就绪（不存在则被创建）

#### Scenario: 页面加载自动初始化

- **WHEN** 用户打开看板页面或切换到下拉中的另一项目，且该项目缺少 kanban 结构
- **THEN** 页面自动调用初始化接口完成补全，并向用户给出"已自动初始化"的提示，后续新建线程、活跃切换等操作不受阻

#### Scenario: 旧版服务降级

- **WHEN** 页面连接的是不支持初始化接口的旧版看板服务
- **THEN** 初始化调用失败被静默跳过，页面其余功能照常工作

#### Scenario: 写操作缺结构自动补齐

- **WHEN** 项目缺少 kanban 结构时发起线程创建或活跃线程切换
- **THEN** 服务先自动补齐缺失的目录与文件，再完成操作；线程创建使用项目自有模板（缺失则用内置默认模板）生成卷宗

## MODIFIED Requirements

### Requirement: 线程创建与删除接口

服务 SHALL 提供线程创建接口：请求携带线程标题；服务 SHALL 分配下一个未用的序号 id、生成 slug（允许调用方指定），套用卷宗模板生成卷宗（status 默认为 `立项`，项目自有 `kanban/templates/thread.md` 存在时优先使用，缺失时以内置默认模板兜底），id/slug 冲突时 MUST 返回错误而非覆盖现有线程；创建所需目录结构缺失时 SHALL 自动补齐而非报错。服务 SHALL 提供线程删除接口：删除整个线程目录；目录不存在时返回明确状态；若被删除的是当前活跃线程，SHALL 同时清空 `kanban/current`。删除为真删，不提供回收站。

#### Scenario: 创建线程

- **WHEN** 以标题"用户认证"创建线程，且已有最大序号为 `0002`
- **THEN** 新线程目录为 `0003-<slug>`，卷宗由模板生成、标题已填写、status 为 `立项`

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
