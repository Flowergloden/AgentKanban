# kanban-viewer Specification

## Purpose

作为 kanban 工作流的载体：向所有项目会话注入线程看板常驻约定（`systemPromptPath`），并为一个或多个项目的看板（`kanban/`）提供当前 active thread 的可视化页面——本地 Web 服务随 kimi-code 会话自动生灭，前端展示 `thread.md` 原文，用户无需手动维护任何后台进程或终端窗口。

## Requirements

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

### Requirement: 版本化健康检查与服务主动退出接口

服务 SHALL 在健康检查响应中保留 ok/name/version，并增加 protocolVersion 与 mode（auto 或 persistent）。服务版本 SHALL 来自共享元数据且与该服务所属发布包的 manifest 版本一致。健康检查和只读状态查询 MUST NOT 延长服务存活期限。主动退出接口 SHALL 先正常响应，再退出并释放端口，适用于两种模式；注册表 MUST 保留。普通停止后再次普通启动 SHALL 使用 auto，不继承前一进程的常驻偏好；协调升级除外。

#### Scenario: 健康检查携带版本
- **WHEN** 请求健康检查
- **THEN** 返回真实服务版本、协议版本及运行模式，不因调用方插件版本不同而伪报版本

#### Scenario: 状态检查不保活
- **WHEN** auto 服务没有有效活动，仅被周期性查询健康或状态
- **THEN** 查询不刷新空闲计时，服务仍按空闲期限退出

#### Scenario: 请求主动退出
- **WHEN** 用户显式停止 auto 或 persistent 服务
- **THEN** 接口正常响应后服务退出并释放端口

#### Scenario: 主动退出后注册表保留
- **WHEN** 用户停止常驻服务后通过普通打开入口重新启动
- **THEN** 注册项目仍然可查，运行模式为 auto

### Requirement: 服务随会话结束自动退出

默认 auto 模式 SHALL 以有效活动维持存活，活动包含会话注册、Codex 与 Claude Code 的用户提交及工具完成事件、Kimi 心跳、成功看板业务交互和可见页面续期。系统文件选择对话框打开期间 SHALL 防止 auto 服务空闲退出，对话框关闭后恢复正常空闲计时。连续超过 180 秒无活动后 SHALL 在下一次不超过 30 秒间隔的清理检查中退出；persistent 模式 MUST NOT 因空闲退出。系统 MUST NOT 依赖 SessionEnd 或虚构的 SessionHeartbeat 保证 Codex 或 Claude Code 保活，也不保证闲置聊天或隐藏页面仍然存活。页面 SHALL 仅在可见时约每 60 秒续期，重新可见时立即尝试；有效活动 hook SHALL 有界执行、节流且在服务停止后可重新启动，失败不阻塞用户原任务。本插件服务控制及纯状态/健康探测所触发的工具完成事件 MUST NOT 作为自动恢复或保活信号。

#### Scenario: 心跳停止后服务退出
- **WHEN** auto 模式下所有有效活动停止超过 180 秒
- **THEN** 服务在下次清理检查中退出，即使 Codex 或 Claude Code 闲置聊天尚未关闭

#### Scenario: 会话存活期间服务不退出
- **WHEN** 至少一个会话或可见页面持续在 180 秒以内发送有效活动
- **THEN** 服务保持运行，Kimi 原有约 60 秒心跳仍可作为有效活动

#### Scenario: 系统选择器打开期间服务不退出
- **WHEN** auto 模式下系统文件选择对话框持续打开超过既有空闲期限且没有其他活动
- **THEN** 服务在选择期间继续运行，对话框关闭后才恢复正常空闲计时

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

### Requirement: 多项目注册表

服务 SHALL 持久保存规范化项目根路径、lastSeen 及注册状态，状态为 `pending`（待确认）、`registered`（已注册）或 `ignored`（已忽略）。项目根可来自 hook.cwd 或显式入口参数；新注册和状态操作 MUST 使用绝对路径，路径规范化 SHALL 合并分隔符、尾斜杠、路径片段及平台大小写差异形成的别名。两个宿主 SHALL 默认使用相同宿主无关的用户级目录，并支持显式数据目录覆盖。首次新注册表缺失时 SHALL 非破坏性导入旧 Kimi 注册表，尊重 KIMI_CODE_HOME；新表已有有效数据时 MUST NOT 被旧表覆盖。导入及既有注册表升级 SHALL 将没有注册状态的旧条目全部视为 `registered`，归一化去重、保留较新 lastSeen 并原子写入；MUST NOT 根据目录名称或项目文件猜测状态。失败 MUST 保留源数据并给出诊断。注册和迁移 MUST NOT 创建项目看板结构或读取线程便签内容。

#### Scenario: 会话所在项目被注册
- **WHEN** 两个宿主对相同的新项目上报有效活动
- **THEN** 共享注册表只有规范化后的一条 `pending` 记录，lastSeen 被刷新

#### Scenario: 已确认项目保持注册
- **WHEN** 两个宿主对相同的 `registered` 项目上报有效活动
- **THEN** 共享注册表仍只有一条 `registered` 记录，lastSeen 被刷新

#### Scenario: 注册表在服务重启后保留
- **WHEN** 服务退出后重启
- **THEN** 待确认、已注册和已忽略项目及其状态仍完整可查

#### Scenario: 既有注册表升级
- **WHEN** 新版服务加载不含注册状态字段的既有注册表
- **THEN** 所有旧条目标记为 `registered`，不依据 `kanban/`、`.git` 或目录名称重新分类

#### Scenario: 首次导入旧注册表
- **WHEN** 新表缺失且旧 Kimi 注册表有效
- **THEN** 新表获得旧项目并全部标记为 `registered`，旧文件保持原样，路径重复项按较新 lastSeen 合并

#### Scenario: 不覆盖已有新表
- **WHEN** 新目录已有有效注册表且旧表内容不同
- **THEN** 保留新表内容，不用旧表替换，也不自动向旧表回写

#### Scenario: 迁移损坏数据
- **WHEN** 旧表无法解析或新目录写入失败
- **THEN** 保留旧文件及任何已有有效新数据，报告迁移问题，不声称迁移成功

#### Scenario: 路径别名归一化
- **WHEN** 同一 Windows 目录以不同分隔符、尾斜杠、路径片段或大小写形式被发现
- **THEN** 注册表只保留一个规范化条目，不产生别名重复项

### Requirement: active thread 查询接口

服务 SHALL 提供按项目根路径查询 active thread 的接口：读取该项目的 `kanban/current` 获得活跃线程标识，并返回对应 `kanban/threads/<标识>/thread.md` 的完整原文。无活跃线程或数据缺失时 SHALL 返回明确的状态标识而非异常。

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

前端页面 SHALL 展示指定已注册项目 active thread 的 `thread.md` 内容，并以安全渲染形式呈现 Markdown；读取接口和磁盘文件 MUST 保留原始 Markdown 文本，不保存渲染后的 HTML。页面 SHALL 支持以 URL 参数指定项目根路径；未指定时 SHALL 展示已注册项目中 lastSeen 最近的项目，并提供在已注册项目间切换的入口。URL 指向待确认、已忽略或未登记路径时 MUST NOT 自动注册、确认或初始化，SHALL 显示对应状态及管理入口。无活跃线程时页面 SHALL 显示明确提示。

#### Scenario: 按 URL 参数定位项目

- **WHEN** 用户以带已注册项目根路径参数的 URL 打开页面
- **THEN** 页面直接显示该项目 active thread 的安全渲染内容，读取接口与磁盘中的 Markdown 原文不变

#### Scenario: URL 指向未确认路径

- **WHEN** 用户以带待确认、已忽略或未登记根路径参数的 URL 打开页面
- **THEN** 页面显示项目状态与相应管理入口，不自动改变注册状态或创建 `kanban/`

#### Scenario: 无参数时落到最近项目

- **WHEN** 用户以不带参数的 URL 打开页面，且存在已注册项目
- **THEN** 页面显示 lastSeen 最近已注册项目的 active thread，并可切换到其他已注册项目

#### Scenario: 没有已注册项目

- **WHEN** 注册表为空或只有待确认、已忽略项目
- **THEN** 页面显示无已注册项目的明确提示和项目管理入口

#### Scenario: 项目无活跃线程时的提示

- **WHEN** 被显示的已注册项目没有活跃线程
- **THEN** 页面显示"当前无活跃线程"的明确提示，而非空白或报错

### Requirement: 打开看板入口

Kimi 插件 SHALL 保留 /kanban:open 及等价 skill；Codex 与 Claude Code SHALL 提供宿主可发现的打开 skill，不依赖 Kimi 命令派发或安装路径。打开入口 SHALL 从明确项目根构造 URL 编码参数，先确保服务可用，再将该项目显式确认为 `registered`，然后在默认浏览器打开页面；显式 OpenKanban SHALL 能将新路径、待确认或已忽略项目转为已注册。MUST NOT 将插件目录当项目根。普通打开 SHALL 保留运行中服务的模式，服务未运行时默认 auto。服务无法就绪或确认失败时 SHALL 报告原因而非声称成功打开可用看板。

#### Scenario: 打开当前项目看板
- **WHEN** 用户通过 Kimi 命令或任一宿主的打开 skill 打开新路径、待确认或已忽略项目的看板
- **THEN** 服务先将该项目置为 `registered`，随后浏览器访问当前项目的编码 URL

#### Scenario: 打开路径保持正确
- **WHEN** 项目路径含空格、中文和 Windows 分隔符
- **THEN** 确认与浏览器 URL 使用同一规范化项目根，参数编码正确

#### Scenario: 冷启动和常驻复用
- **WHEN** 用户打开看板，服务未运行或已为 persistent
- **THEN** 未运行时启动 auto，已为 persistent 时保持模式并复用

#### Scenario: 确认失败不误报
- **WHEN** 服务无法就绪或项目确认持久化失败
- **THEN** 入口报告失败原因，不声称已成功打开可用看板

### Requirement: 线程列表与详情查询接口

服务 SHALL 按项目当前 schema 解析线程卷宗。列表接口 SHALL 返回有效 schema、每条线程的标识、标题、最近更新时间、文件指纹、是否活跃，以及按字段 key 组织的类型化值；核心 goal 摘要、status 和 dependencies 投影 SHALL 从对应核心字段派生。详情接口 SHALL 返回各字段的类型化值与用于编辑的原始净内容，并返回 schema 外小节的未映射标记及原文。旧 `status`、`goalExcerpt`、`deps` 和按 label 组织的 `sections` 响应字段 SHALL 在兼容适配期内继续提供。卷宗或 schema 异常 SHALL 返回明确状态，不影响无关项目。

#### Scenario: 查询线程列表

- **WHEN** 项目存在若干符合当前 schema 的线程卷宗
- **THEN** 接口返回每条线程的系统元数据、全部字段值和文件指纹，并正确标记活跃线程

#### Scenario: 列表投影携带依赖

- **WHEN** 线程 A 的核心 dependencies 字段包含 `- 0002` 与 `- 0004`
- **THEN** 列表字段投影中 A 的 dependencies 为 `["0002", "0004"]`，兼容字段 deps 保持相同值

#### Scenario: 无依赖时投影为空列表

- **WHEN** 某线程没有依赖小节，或核心 dependencies 字段内容为空
- **THEN** 该线程的 dependencies 与兼容 deps 投影均为空列表

#### Scenario: 自定义字段进入列表投影

- **WHEN** schema 包含自定义 select 或 reference 字段
- **THEN** 每条线程的字段投影按稳定 key 返回对应标量或线程序号列表，前端无需按显示 label 猜测类型

#### Scenario: 兼容旧列表消费方

- **WHEN** 旧消费方读取默认 schema 项目的列表响应
- **THEN** 仍可读取 status、goalExcerpt 与 deps，其值分别来自核心 status、goal 和 dependencies 字段

#### Scenario: 查询线程详情

- **WHEN** 查询某条存在线程的详情
- **THEN** 接口返回其标题、全部 schema 字段的原始净内容与类型化值、未映射小节和文件指纹

#### Scenario: 小节内容为净内容

- **WHEN** 查询某线程详情，其卷宗字段内容前后带有排版空行
- **THEN** 接口返回的字段原始内容首尾不含这些结构性空行

#### Scenario: 旧模板注释不作为字段值展示

- **WHEN** 既有卷宗字段仅含旧模板说明注释，或注释与正式内容并存
- **THEN** 类型化投影和表格展示忽略这些说明注释，原始文件不被读取操作修改

#### Scenario: 未映射小节随详情返回

- **WHEN** 卷宗包含当前 schema 外的小节
- **THEN** 详情响应携带其原始标题与内容并标记未映射，不把内容并入其他字段

#### Scenario: 线程目录缺少卷宗

- **WHEN** 某线程目录下不存在 `thread.md`
- **THEN** 该线程在列表中以“卷宗缺失”状态呈现，不影响其他线程的返回

### Requirement: 线程小节更新接口（乐观并发）

服务 SHALL 提供按稳定字段 key 更新线程卷宗的接口：请求携带线程标识、字段 key、符合字段类型的值或 Markdown 原始净内容，以及读取时获得的文件指纹。服务 MUST 在写盘前校验指纹与字段值；指纹不匹配时返回 409，非法 select 或 reference 值返回明确错误，均不写盘。匹配时 SHALL 仅替换目标字段，其他字段、注释及未映射小节一字不改，并原子写盘。卷宗缺失目标字段时 SHALL 按当前 schema 补建该字段及标记；旧 section/status 接口 SHALL 在兼容适配期内映射到同一字段更新语义。

#### Scenario: 指纹匹配时更新成功

- **WHEN** 更新请求携带的指纹与当前文件一致且字段值合法
- **THEN** 目标字段被替换，文件其余部分保持不变，接口返回成功与新的文件指纹

#### Scenario: 写回恢复规范空行

- **WHEN** 更新请求携带的 Markdown 净内容首尾没有空行
- **THEN** 落盘后的字段标题之后、字段末尾与下一标题之间各保留一个空行

#### Scenario: 指纹不匹配时拒绝写入

- **WHEN** 请求指纹与当前文件不一致
- **THEN** 接口返回 409 冲突状态，文件内容不发生任何变化

#### Scenario: 拒绝非法字段值

- **WHEN** select 值不在 options 中，或 reference 值不是线程序号列表
- **THEN** 接口返回明确错误且不写盘，不将非法值序列化进卷宗

#### Scenario: 更新不存在的小节或线程

- **WHEN** 请求指向不存在的线程，或当前 schema 未配置的字段 key
- **THEN** 接口返回明确错误状态，文件不发生任何变化

#### Scenario: 依赖小节缺失时自动补建

- **WHEN** 更新目标为当前 schema 已配置但卷宗中缺失的字段，且指纹匹配
- **THEN** 服务按 schema 顺序或文档末尾的确定规则补建字段与稳定 key 标记后写入内容，其他原文保持不变

#### Scenario: 旧小节接口使用默认 schema

- **WHEN** 旧消费方以默认 label 调用 section 或 status 更新接口
- **THEN** 服务将其映射到对应核心字段并沿用相同校验、并发与写盘行为

### Requirement: 全局便签读写接口与页面入口

服务 SHALL 提供全局便签的读取接口（`GET /api/note`）与保存接口（`PUT /api/note`）：读取返回 `kanban/note.md` 原文与文件指纹，文件缺失时按空内容返回而不报错；保存以指纹做乐观并发校验，指纹不匹配时 MUST 返回 409 且不写盘，匹配时 SHALL 原子写盘（临时文件 + 重命名）并返回新指纹。看板页面 SHALL 在项目上下文中提供「便签」入口，弹出编辑模态框展示与修改便签内容，并提供安全 Markdown 即时预览。便签修改 SHALL 在停止输入后自动保存并展示真实保存状态，成功保存后编辑框保持打开；保存遇 409 时 SHALL 提示冲突并保留本地草稿，MUST NOT 静默覆盖。便签内容 MUST NOT 进入线程工作流：卷宗解析、Agent 会话校准等动作不读取便签。

#### Scenario: 打开并保存便签

- **WHEN** 用户点击页面头部「便签」按钮，在弹出的编辑框中修改内容并停止输入
- **THEN** 预览同步更新，`kanban/note.md` 被自动原子写盘，接口返回新指纹，页面显示已保存且编辑框保持打开

#### Scenario: 便签文件缺失

- **WHEN** 项目的 `kanban/note.md` 不存在时调用读取接口
- **THEN** 接口返回空内容与空内容的指纹，不产生错误，也不自动创建文件

#### Scenario: 便签保存冲突

- **WHEN** 自动或手动保存便签时携带的指纹与当前文件不一致（文件已被其他写者修改）
- **THEN** 接口返回 409，页面提示"文件已被修改"、保留本地草稿并提供冲突处理入口，不发生静默覆盖

### Requirement: 线程状态流转与活跃切换接口

服务 SHALL 提供线程 status 流转接口：仅接受 `立项`、`规划`、`实现`、`完成` 四个合法值，非法值 SHALL 返回错误且不写盘；流转 SHALL 仅修改卷宗中的 status 字段，其余内容不变。服务 SHALL 提供设置/取消活跃线程的接口：设置时将线程标识写入 `kanban/current`（同时刻最多一条活跃线程），取消时清空该文件。

#### Scenario: 合法流转 status

- **WHEN** 将某线程的 status 流转为 `实现`
- **THEN** 卷宗 status 字段更新为 `实现`，卷宗其余内容不变

#### Scenario: 拒绝非法 status 值

- **WHEN** 请求将 status 改为四个合法值之外的值
- **THEN** 接口返回错误状态，卷宗不变

#### Scenario: 设置与取消活跃线程

- **WHEN** 将线程 T 设为活跃，随后取消活跃
- **THEN** 设置后 `kanban/current` 内容为 T 的标识；取消后该文件为空

### Requirement: kanban 结构初始化与惰性补齐

服务 SHALL 提供初始化接口：仅对已注册项目创建 `kanban/`、`kanban/threads/`、`kanban/thread.schema.json`、空 `kanban/current` 与带人类专属说明的 `kanban/note.md`；新项目 MUST NOT 再创建 `kanban/templates/` 或 `kanban/templates/thread.md`。初始化 MUST 幂等，已存在文件不得被覆盖。既有模板 SHALL 原样保留但不再作为创建依据。插件 SessionStart hook 和普通页面加载 MUST NOT 自动初始化；已注册项目的线程创建、活跃切换等写操作在结构缺失时 SHALL 自动补齐。

#### Scenario: 初始化空白项目

- **WHEN** 用户在已注册但没有 `kanban/` 的项目页面选择初始化
- **THEN** 服务创建包含默认 schema 的最小看板结构，不创建模板目录或模板文件，响应列出新创建的 schema 等文件

#### Scenario: 未确认路径拒绝初始化

- **WHEN** 对待确认、已忽略或未登记路径调用初始化或其他会创建看板结构的写接口
- **THEN** 服务返回明确错误，项目文件系统不发生任何变化

#### Scenario: 页面加载自动初始化

- **WHEN** 页面加载或切换到已注册但没有 `kanban/` 的项目
- **THEN** 页面显示“初始化”和“忽略”选项，不在选择前自动创建结构

#### Scenario: 重复初始化幂等

- **WHEN** 对已具备完整结构的已注册项目再次调用初始化接口
- **THEN** 不创建、不修改任何已有路径与文件，返回空的新建列表

#### Scenario: 旧项目补齐 schema

- **WHEN** 已有看板项目包含模板和卷宗但缺少 `thread.schema.json`，随后发生需要补齐结构的写操作
- **THEN** 服务仅补齐默认 schema 等缺失结构，旧模板与所有卷宗保持不变

#### Scenario: 会话启动不初始化项目

- **WHEN** 某项目的宿主会话启动并完成自动发现或显式确认，且该项目不存在 `kanban/` 结构
- **THEN** 该项目的文件系统不发生任何变化，`kanban/` 结构不会被创建

#### Scenario: 旧版服务降级

- **WHEN** 用户在连接旧版服务的页面显式选择初始化，而服务不支持该接口
- **THEN** 页面报告无法初始化，不静默声称成功，其余只读功能保持可用

#### Scenario: 写操作缺结构自动补齐

- **WHEN** 已注册项目缺少 kanban 结构时发起线程创建或活跃线程切换
- **THEN** 服务先自动补齐缺失的目录、默认 schema 与文件，再完成操作

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

### Requirement: 线程创建与删除接口

服务 SHALL 提供线程创建接口：请求携带线程标题，允许携带写入核心 goal 字段的目标描述；目标描述非字符串或超过 5000 字符时 MUST 返回错误。服务 SHALL 分配序号与 slug，按当前 schema 程序化生成卷宗，写入标题、核心 status 默认值、字段说明注释与稳定 key 标记；提供目标描述时 SHALL 写入核心 goal 字段，不再读取项目模板。待命名 slug、保留字和冲突规则保持既有行为。服务 SHALL 提供线程删除接口：删除整个线程目录；若被删除的是当前活跃线程，SHALL 同时清空 `kanban/current`。删除为真删，不提供回收站。

#### Scenario: 创建线程

- **WHEN** 以标题“用户认证”创建线程，且已有最大序号为 `0002`
- **THEN** 新线程目录为 `0003-<slug>`，卷宗由当前 schema 生成，标题已填写，核心 status 为其默认值

#### Scenario: 项目自有模板缺失时使用内置模板

- **WHEN** 旧项目仍缺少模板文件，或新项目从未创建模板文件
- **THEN** 服务使用内置默认 schema 生成包含六个核心字段、原状态选项与字段说明的卷宗，不读取或补建模板

#### Scenario: 自定义 schema 生成字段注释

- **WHEN** 当前 schema 包含带说明和选项的自定义 select 字段
- **THEN** 新卷宗按字段顺序包含该小节、稳定 key 标记、说明和选项注释

#### Scenario: 中英文标题留空 slug 均创建为待命名线程

- **WHEN** 分别以中文标题和英文标题创建线程且 slug 留空
- **THEN** 两条新线程目录的 slug 均为 `unnamed-pending`，创建成功且不从标题自动生成

#### Scenario: 多条待命名线程共存

- **WHEN** 已存在一条待命名线程，再以另一标题创建线程且 slug 留空
- **THEN** 新线程获得下一序号并继续使用 `unnamed-pending` 占位，不因 slug 相同而报错

#### Scenario: 保留字拒绝显式使用

- **WHEN** 调用方创建线程时显式指定 `unnamed-pending` 为 slug
- **THEN** 接口返回错误且不创建线程

#### Scenario: 空白项目直接创建线程

- **WHEN** 在一个没有任何 kanban 结构的项目中直接发起线程创建
- **THEN** 服务自动创建包含默认 schema 的看板结构并完成线程创建，不再创建或要求模板

#### Scenario: 创建时携带目标描述

- **WHEN** 以标题“用户认证”与目标描述“打通登录与注册”创建线程
- **THEN** 卷宗核心 goal 字段内容为该描述，其余字段保持生成默认值和说明注释

#### Scenario: 目标描述非法

- **WHEN** 创建线程时目标描述为非字符串，或超过 5000 字符
- **THEN** 接口返回错误，不创建线程目录

#### Scenario: 删除普通线程

- **WHEN** 用户删除一条非活跃线程
- **THEN** 其线程目录被移除，`kanban/current` 不受影响

#### Scenario: 删除活跃线程

- **WHEN** 删除的线程正是 `kanban/current` 指向的活跃线程
- **THEN** 线程目录被移除，且 `kanban/current` 被清空

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

### Requirement: 看板页面的线程视图

页面 SHALL 按有效 `schema.views` 的配置顺序展示视图入口，并使用配置 label；MUST NOT 遍历字段类型自动派生额外入口。唯一不携带 `fieldKey` 的 table 配置对应全部线程基础表格，表格按 schema 顺序展示全部字段及标识、标题、最近更新等系统列。其他入口 SHALL 根据目标字段 `type` 推导运行时 kind：select 对应 board，reference 对应 graph；配置本身 MUST NOT 携带独立 kind。board 入口 SHALL 仅读取其绑定的 select 字段并按 options 分组，graph 入口 SHALL 仅读取其绑定的 reference 字段建图；默认 schema 显式配置 status 看板与 dependencies 引用图。活跃线程在各视图中 SHALL 有明显标识，看板拖拽 SHALL 更新其分组字段。当前视图选择 SHALL 仅保留在页面状态中，MUST NOT 写入 schema、URL 或 localStorage；本变更不提供通用筛选或自定义视图插件，固定“未完成”视图 SHALL 移除。项目切换与既有 URL 项目定位行为保持不变。

#### Scenario: 基础表格展示全部字段

- **WHEN** 用户打开使用自定义 schema 的项目
- **THEN** 配置的表格按字段配置顺序显示核心与自定义字段，长 Markdown 以摘要呈现，字段类型由 schema 决定

#### Scenario: 视图名称与顺序由配置决定

- **WHEN** 项目在 `views` 中调整入口 label 和排列顺序
- **THEN** 页面严格按该顺序显示配置名称，不再使用“看板：字段名”或“引用图：字段名”的程序拼接名称

#### Scenario: 自定义字段不自动产生视图

- **WHEN** schema 新增 select 或 reference 字段但未在 `views` 中配置对应入口
- **THEN** 字段仍出现在表格和详情中，页面不自动增加看板或引用图入口

#### Scenario: 切换视图

- **WHEN** 用户在基础表格、已配置的看板或引用图之间切换
- **THEN** 页面展示当前配置对应的视图；看板使用绑定字段的 options 分列，引用图使用绑定字段的引用建图

#### Scenario: 拖拽流转状态

- **WHEN** 用户在核心 status 看板中将卡片从“立项”列拖入“实现”列
- **THEN** 仅该线程的核心 status 字段被更新为“实现”，卡片显示在“实现”列

#### Scenario: 从引用字段切换图形视图

- **WHEN** 用户选择绑定任一 reference 字段的图形视图
- **THEN** 页面根据该字段的线程序号列表渲染引用图，而非固定读取核心 dependencies

#### Scenario: 默认视图入口

- **WHEN** 项目使用默认 schema，或既有合法 schema 省略 `views`
- **THEN** 有效配置提供全部字段表格、核心 status 看板和核心 dependencies 引用图，不提供固定未完成筛选视图；缺省补全不回写项目文件

#### Scenario: 当前视图配置失效

- **WHEN** 外部修改 schema 后，当前入口被移除、fieldKey 改变、绑定字段不再存在或类型变化导致推导 kind 改变
- **THEN** 页面回退到配置的表格并显示明确提示，不继续向旧字段写入

#### Scenario: 当前视图选择不持久化

- **WHEN** 用户选择非表格视图后刷新页面或切换项目
- **THEN** 页面从配置的表格视图开始，不把最后选择写入项目文件、URL 或浏览器存储；引用图节点位置的既有独立持久化不受此限制

#### Scenario: 活跃线程标识

- **WHEN** 某线程是 `kanban/current` 指向的活跃线程
- **THEN** 它在各视图中带有明确的活跃标识

### Requirement: 依赖图视图

看板页面 SHALL 将任一 reference 字段呈现为线程引用图：以全部线程为节点，按核心 status 着色并高亮活跃线程，以所选字段的序号列表派生有向边，箭头指向被引用方。引用数据 MUST 全部派生自字段投影，不引入新的存储。视图 SHALL 保留自动分层、节点拖动、连线增删引用、自引用拦截、成环标记和悬空幽灵节点。节点位置 SHALL 按项目根、字段 key 与线程标识持久化于浏览器 localStorage，MUST NOT 写入 `kanban/`。点击实体节点 SHALL 跳转对应线程详情。

#### Scenario: 依赖图派生渲染

- **WHEN** 线程 A 的所选 reference 字段包含线程 B 的序号
- **THEN** 图中 A 与 B 各为一个节点，存在从 A 指向 B 的有向边

#### Scenario: 非核心引用字段建图

- **WHEN** 用户选择自定义 reference 字段
- **THEN** 图仅根据该字段建边，核心 dependencies 不被混入

#### Scenario: 自动分层布局

- **WHEN** 打开引用图视图
- **THEN** 被引用方按引用深度位于引用方上层；活跃线程高亮，各节点按核心 status 着色

#### Scenario: 节点位置持久化

- **WHEN** 用户在一个引用图中拖动节点后切换到另一 reference 字段或刷新页面
- **THEN** 各图恢复各自的节点位置，`kanban/` 下任何文件不因拖拽而变化

#### Scenario: 连线建立依赖

- **WHEN** 用户从节点 A 拖拽连线到节点 B 并确认落线
- **THEN** B 的序号经字段更新接口写入 A 的所选 reference 字段，缺字段时由接口补建，图中出现 A→B

#### Scenario: 拒绝自依赖连线

- **WHEN** 用户将连线落回起点节点自身
- **THEN** 不建立引用，不发生写操作

#### Scenario: 删除依赖连线

- **WHEN** 用户点选已有边 A→B 并确认删除
- **THEN** B 的序号仅从 A 的所选 reference 字段移除，该边消失

#### Scenario: 闭环标记

- **WHEN** 所选字段的引用关系构成环路
- **THEN** 环路上的节点与边以醒目样式标记，视图与线程流转均不受其他影响

#### Scenario: 悬空引用渲染为幽灵节点

- **WHEN** 所选字段含无对应线程的序号
- **THEN** 图中以可辨识的幽灵样式呈现该序号节点及其入边，不影响其他节点渲染

#### Scenario: 点击节点跳转详情

- **WHEN** 用户点击引用图中的某实体节点
- **THEN** 页面切换到该线程的详情视图

### Requirement: 看板页面的线程详情与分小节编辑

页面 SHALL 提供 schema 驱动的线程详情视图，按配置顺序和 label 展示全部字段。markdown 字段 SHALL 使用安全渲染和统一 Live Preview；select 字段 SHALL 通过选项控件编辑；reference 字段 SHALL 将有效序号渲染为线程标题链接并标记悬空引用；file 字段 SHALL 展示路径、提供只读预览，并在编辑时使用系统选择器与移除控件。核心 goal 保持随手可改，其他字段默认只读并在点击“编辑”后解锁。所有编辑 SHALL 保留自动保存、最新指纹与冲突处理。schema 外小节 SHALL 以未映射状态只读展示并保留原文。详情视图 SHALL 提供设置/取消活跃线程与核心 status 流转入口。

#### Scenario: 详情字段由 schema 决定

- **WHEN** 用户打开包含自定义字段的线程详情
- **THEN** 页面按当前 schema 顺序显示核心与自定义字段，不再使用固定小节数组

#### Scenario: 目标随手可改

- **WHEN** 用户在详情页编辑核心 goal 字段并停止输入
- **THEN** Live Preview 更新，该字段自动保存，页面显示新内容、最新指纹与已保存状态

#### Scenario: Agent 生成小节默认锁定

- **WHEN** 用户查看非核心 goal 的任一字段
- **THEN** 该字段默认只读，点击“编辑”后才变为可编辑

#### Scenario: 依赖小节默认锁定且可编辑

- **WHEN** 用户查看并编辑核心 dependencies 或其他 reference 字段
- **THEN** 字段默认只读，点击“编辑”后通过引用控件解锁编辑，不要求手写序号列表

#### Scenario: 单选与引用字段使用类型编辑器

- **WHEN** 用户编辑 select 或 reference 字段
- **THEN** 页面提供对应选项控件或线程引用编辑，不要求用户手写底层序列化格式

#### Scenario: 文件字段使用专用展示与编辑器

- **WHEN** 用户查看或编辑 file 字段
- **THEN** 只读模式显示完整路径并提供预览入口，编辑模式通过系统选择器添加和单项移除，不回退为线程引用控件或手输路径控件

#### Scenario: 依赖条目渲染为可点击链接

- **WHEN** 查看的 reference 字段含有效线程序号
- **THEN** 该条目显示目标线程序号与标题，点击后跳转到对应线程详情

#### Scenario: 悬空依赖显示标记

- **WHEN** reference 字段含不存在的线程序号
- **THEN** 该条目显示悬空标记与原始序号，不渲染为有效线程链接

#### Scenario: 未映射小节只读保留

- **WHEN** 卷宗包含当前 schema 外的小节
- **THEN** 详情明确标记并展示其原始内容，不提供会绕过 schema 的普通字段编辑入口

#### Scenario: 详情页切换活跃与状态

- **WHEN** 用户在详情页点击“设为活跃”或变更核心 status
- **THEN** 对应接口被调用，页面反映最新的活跃标识与状态

### Requirement: 看板页面的创建删除与冲突提示

页面 SHALL 提供创建线程入口：要求填写标题，并允许填写核心 goal 字段的目标描述；目标输入 SHALL 提供安全 Markdown Live Preview，创建前 MUST NOT 自动保存。创建成功后可跳转到新线程详情。页面 SHALL 提供删除线程入口：删除前需确认；删除当前活跃线程时需二次明确确认。任何写操作收到 409 时，页面 SHALL 明确提示、保留本地草稿并提供冲突处理入口，MUST NOT 静默覆盖。

#### Scenario: 创建线程入口

- **WHEN** 用户在页面发起创建并填写标题
- **THEN** 新线程被创建，页面展示新线程

#### Scenario: 创建时填写目标描述

- **WHEN** 用户在创建对话框中填写标题与目标描述后创建
- **THEN** 创建前仅更新目标预览，创建请求携带标题与目标描述，新卷宗核心 goal 字段包含所填内容

#### Scenario: 删除活跃线程的二次确认

- **WHEN** 用户删除的线程是当前活跃线程
- **THEN** 页面在普通确认之外给出第二次明确确认，用户确认后才执行删除

#### Scenario: 写冲突提示

- **WHEN** 保存编辑时接口返回 409
- **THEN** 页面提示文件已被修改、保留本地草稿并提供冲突处理入口，不发生静默覆盖

### Requirement: 显式常驻与服务控制入口

系统 SHALL 提供可脱离 Agent 执行的常驻启动、取消常驻、状态查询和显式停止脚本入口，并提供宿主 skill 引导。常驻启动 SHALL 在未运行时后台启动 persistent，在 auto 时原地切换，重复调用幂等；取消常驻 SHALL 原地切换 auto 并从操作时重新计时。普通活动与普通打开 MUST NOT 取消常驻。模式为所有项目共享的服务级状态，不是开机自启或永久用户偏好。无服务时取消、查询和停止 MUST NOT 启动新进程。停止仅结束当前进程，后续有效启动/活动入口仍可默认 auto 恢复；入口 MUST 说明这一边界与影响全部项目的范围。

#### Scenario: 脱离 Agent 常驻启动
- **WHEN** 用户从任意工作目录执行带明确项目参数的常驻脚本
- **THEN** 服务以 persistent 后台运行，不依赖聊天、不自动打开浏览器、不创建看板结构

#### Scenario: 原地提升且不重复启动
- **WHEN** 用户对运行中的 auto 服务连续调用常驻启动
- **THEN** 同一进程切换并保持 persistent，普通打开或另一会话活动不将其降级

#### Scenario: 取消常驻获得完整空闲期限
- **WHEN** 服务已常驻超过 180 秒后用户取消常驻
- **THEN** 同一进程切换 auto，从取消时开始计算新的 180 秒空闲期限

#### Scenario: 没有服务时的控制
- **WHEN** 服务未运行，用户执行取消常驻、状态查询或重复停止
- **THEN** 返回明确未运行状态，不拉起服务

#### Scenario: 模式不跨普通重启保留
- **WHEN** 常驻进程被主动停止、异常终止或系统重启后，用户普通启动
- **THEN** 默认进入 auto，不从永久标记恢复常驻，也不自动注册系统启动项

### Requirement: 运行模式可见与控制校验

看板页面 SHALL 展示真实 auto/persistent 状态，提供常驻与取消常驻入口，并说明模式影响所有项目；显式停止的页面操作 SHALL 先确认影响范围。模式控制 SHALL 校验输入，仅接受合法模式，拒绝非法请求且不改变状态。新增浏览器模式控制 MUST 限制同源请求及 JSON 输入，不开放跨域写权限；升级期间的冲突 SHALL 可识别并允许重试，前端 MUST NOT 在失败时显示操作成功。

#### Scenario: 显示与切换模式
- **WHEN** 用户在页面切换常驻或取消常驻且服务确认成功
- **THEN** 页面显示服务返回的新模式；失败时保留真实状态并显示原因

#### Scenario: 拒绝非法控制
- **WHEN** 请求带非法模式或来自不被允许的浏览器来源
- **THEN** 控制被拒绝，当前运行模式不变

#### Scenario: 页面停止提示全局影响
- **WHEN** 用户从页面发起停止
- **THEN** 先提示影响全部项目并要求确认，取消则不发送停止请求

### Requirement: P4 受管状态检测与缓存

服务 SHALL 在项目被显式确认为已注册，以及已注册项目的看板页面加载/切换时，检测该项目 `kanban/` 路径是否受 P4 管理；待确认和已忽略路径 MUST NOT 触发 P4 检测。检测 SHALL 基于 `p4` CLI 的客户端视图映射计算（不依赖服务器可达），且 MUST 以项目根作为 p4 命令的工作目录。检测结果 SHALL 以 `vcs` 字段缓存于注册表对应项目条目，字段形状 MUST 能区分 VCS 类型，字段缺失表示"未检测"。`p4` CLI 不可用或路径未映射进客户端视图时 SHALL 按非 P4 项目处理，且不向用户产生错误。检测 MUST NOT 创建或修改项目 `kanban/` 结构。

#### Scenario: 注册或加载时检测并缓存
- **WHEN** 项目被显式确认为已注册，或看板页面加载/切换到已注册项目
- **THEN** 服务执行受管检测，并将结果写入注册表对应项目的 `vcs` 字段

#### Scenario: 未确认路径不检测
- **WHEN** 自动发现待确认路径，或活动上报指向已忽略路径
- **THEN** 服务不调用 P4 检测，也不修改其 VCS 缓存

#### Scenario: p4 不可用或未映射
- **WHEN** 目标机器无 `p4` CLI，或该项目 `kanban/` 未映射进客户端视图
- **THEN** 该项目按非 P4 项目处理，写路径行为与既有版本一致，不向用户报错

#### Scenario: 再次加载时刷新缓存
- **WHEN** 某已注册项目的 P4 映射关系在缓存后发生变化，页面再次加载该项目
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

### Requirement: 自动发现与人工状态流转

自动发现 SHALL 只创建或刷新待确认记录，不得把待确认项目直接转为已注册，也不得改变已注册或已忽略状态。人工确认 SHALL 将新路径、待确认或已忽略项目转为已注册；忽略 SHALL 将待确认或已注册项目转为已忽略；取消忽略 SHALL 将项目恢复为已注册。状态变更 SHALL 原子持久化。

#### Scenario: 重复自动发现待确认项目
- **WHEN** 同一待确认路径再次收到普通会话或活动上报
- **THEN** 仍只有一条待确认记录，仅 lastSeen 按活动刷新

#### Scenario: 自动发现不推翻忽略
- **WHEN** 已忽略路径再次收到普通会话或活动上报
- **THEN** 记录保持已忽略，不重新进入待确认，服务活动续期不受影响

#### Scenario: Web 确认待确认项目
- **WHEN** 用户在项目管理界面确认一个待确认项目
- **THEN** 项目转为已注册并出现在主项目列表，状态在服务重启后保留

#### Scenario: 忽略与取消忽略
- **WHEN** 用户忽略一个待确认或已注册项目，随后取消忽略
- **THEN** 项目先转为已忽略并从主列表移除，取消后恢复为已注册，项目文件始终不变

### Requirement: Web 项目管理与手动新增

页面 SHALL 提供项目管理入口，分区展示待确认、已注册和已忽略项目，并提供确认、忽略、取消忽略及删除操作。手动新增 SHALL 接受绝对项目根路径并验证其为现存目录，成功后直接成为已注册；非法路径、非绝对路径或目录不存在时 MUST 返回明确错误且不改变注册表。手动新增本身 MUST NOT 创建 `kanban/`。

#### Scenario: 手动新增现存目录
- **WHEN** 用户提交一个尚未登记的现存目录绝对路径
- **THEN** 该项目以已注册状态持久化，且不自动初始化看板

#### Scenario: 手动新增重复项目
- **WHEN** 用户提交与既有待确认、已注册或已忽略项目等价的规范化路径
- **THEN** 服务不产生重复记录，并将该项目确认到已注册状态

#### Scenario: 拒绝无效手动新增
- **WHEN** 用户提交相对路径、文件路径或不存在的目录
- **THEN** 页面显示明确错误，注册表不发生变化

#### Scenario: 管理操作失败
- **WHEN** 新增或状态变更因校验、持久化或服务错误失败
- **THEN** 页面保留真实项目状态并显示错误，不展示虚假的成功结果

### Requirement: 注册删除与当前项目导航

删除 SHALL 仅移除注册表记录，MUST NOT 删除或修改项目目录及 `kanban/` 内容。删除后再次自动发现 SHALL 只创建待确认记录。删除或忽略当前展示项目时，页面 SHALL 切换到下一个最近已注册项目；没有已注册项目时显示空状态，并清理或替换 URL 中的项目根参数，避免刷新后恢复已移除上下文。

#### Scenario: 删除历史误注册
- **WHEN** 用户删除一条待确认、已注册或已忽略记录
- **THEN** 该记录从注册表移除，项目目录与看板文件保持原样

#### Scenario: 删除后再次发现
- **WHEN** 已删除路径仍有会话活动并再次自动上报
- **THEN** 服务只建立待确认记录，不直接恢复为已注册

#### Scenario: 移除当前项目
- **WHEN** 用户删除或忽略当前展示项目
- **THEN** 页面选择下一最近已注册项目或进入空状态，并更新 URL 使其不再指向已移除项目

### Requirement: 安全的 Markdown 渲染

页面 SHALL 支持常见 GFM 内容的安全渲染，并在插入页面前清理不可信 HTML；脚本、事件处理属性、危险 URL 及非必要活动内容 MUST NOT 执行。渲染失败 SHALL 显示可识别的错误状态，MUST NOT 将未清理 HTML 插入页面。

#### Scenario: 常见语法渲染

- **WHEN** Markdown 含标题、列表、表格、任务列表、代码块、引用或链接
- **THEN** 页面显示对应格式，原始 Markdown 文件内容不因此改变

#### Scenario: 恶意内容被清理

- **WHEN** Markdown 含脚本、`onerror`、`javascript:` 链接、iframe 或危险 SVG 内容
- **THEN** 页面不执行脚本或危险导航，不渲染被禁止的活动内容，其余安全文本仍可阅读

### Requirement: 自动保存状态与连续输入一致性

既有线程小节和便签 SHALL 在内容实际变化并短暂停止输入后自动保存，未变化时 MUST NOT 产生重复写请求。页面 SHALL 显示未保存、保存中、已保存、失败或冲突状态；保存期间发生的新输入 MUST NOT 被旧响应覆盖，离开编辑前 SHALL 尝试提交已修改但未保存的内容。

#### Scenario: 连续输入保存最新版本

- **WHEN** 一次自动保存尚未完成时用户继续输入
- **THEN** 旧响应不覆盖新草稿，随后使用最新指纹保存最新内容，最终磁盘内容与已确认的最新草稿一致

#### Scenario: 保存失败保留草稿

- **WHEN** 自动保存因网络或服务错误失败
- **THEN** 页面显示保存失败并保留本地草稿，提供重试入口，不显示已保存

#### Scenario: 离开前提交待保存内容

- **WHEN** 用户在防抖等待期间完成编辑或关闭便签
- **THEN** 页面立即尝试保存待处理内容；失败时保留可恢复的编辑上下文并提示，而非静默丢弃

### Requirement: 可见页面自动读取外部变更

页面 SHALL 在可见时定期检查当前项目 schema、线程详情、已打开便签和线程列表的外部变更，并在重新可见或获得焦点时立即检查。指纹与有效 schema 未变化时 MUST NOT 重置编辑或滚动状态；页面隐藏时 SHALL 暂停检查。本地无未保存修改时 SHALL 自动采用已变化的外部版本；schema 变化 SHALL 更新字段投影和可用视图，当前视图失效时按表格回退规则处理。

#### Scenario: 干净页面采用外部变更

- **WHEN** 当前文档没有未保存修改，Agent、文本编辑器或其他窗口改变其内容
- **THEN** 页面在后续检查中显示外部新版本并更新指纹，无需手动刷新

#### Scenario: 外部变更未影响当前小节

- **WHEN** 用户正在编辑某字段，外部仅修改该卷宗的其他字段
- **THEN** 页面保留当前草稿，采用外部其他字段和最新指纹，当前编辑可继续保存

#### Scenario: 外部修改 schema

- **WHEN** 页面可见且项目 schema 的字段、选项、字段顺序或视图配置被外部修改
- **THEN** 后续检查采用新 schema 更新表格与视图，不用旧字段配置继续写回

#### Scenario: 隐藏页面暂停检查

- **WHEN** 页面处于隐藏状态
- **THEN** 外部变更轮询暂停；页面重新可见或获得焦点时立即检查并采用符合冲突规则的版本

### Requirement: 外部变更的三方合并与冲突处理

当本地草稿与外部版本相对共同基准均有修改时，页面 SHALL 执行三方合并。无冲突结果 SHALL 自动采用并基于外部最新指纹保存；存在重叠冲突时 SHALL 暂停自动保存、保留双方内容并提供对比与人工合并入口，MUST NOT 静默覆盖或把冲突标记写入文件。

#### Scenario: 非重叠修改自动合并

- **WHEN** 本地与外部基于同一基准修改了同一内容的不同区域，且合并结果无冲突
- **THEN** 页面采用包含双方修改的结果并保存，显示合并与保存状态，不丢失任一方修改

#### Scenario: 重叠修改要求人工处理

- **WHEN** 本地与外部修改同一区域且无法无冲突合并
- **THEN** 自动保存暂停，页面展示本地与外部版本及人工处理入口，磁盘文件不被合并结果或冲突标记改写

#### Scenario: 合并期间继续输入

- **WHEN** 三方合并尚未完成时本地草稿再次变化
- **THEN** 页面作废旧合并计算并基于最新草稿重新处理，不用旧结果覆盖新输入

#### Scenario: 人工解决后保存

- **WHEN** 用户根据本地与外部版本完成人工合并并确认保存
- **THEN** 页面使用检测到的最新外部指纹提交解决后的内容，成功后更新共同基准并恢复自动保存

### Requirement: 统一的 Markdown Live Preview 编辑表面

便签、线程全部可编辑小节和新建线程目标 SHALL 使用单一 Live Preview 编辑表面。光标所在段落物理行或直接列表项 SHALL 显示可编辑 Markdown 标记，代码、表格等复杂结构以完整语法块为编辑单位，其余内容 SHALL 显示同步的安全渲染结果；普通编辑状态 MUST NOT 再要求独立预览栏。

#### Scenario: 全入口统一编辑体验

- **WHEN** 用户分别编辑便签、线程目标、已完成的工作、决策、Changes、依赖及新建线程目标
- **THEN** 每个入口都在同一编辑表面中显示原文标记与相邻区块的实时渲染，不再出现左右或上下分离的普通预览栏

#### Scenario: 活动编辑单元与非活动内容切换

- **WHEN** 用户将光标从当前 Markdown 行、直接列表项或复杂块移动到另一编辑单元
- **THEN** 原编辑单元恢复渲染，新当前单元显示可编辑标记，光标与文本内容不因视觉切换而丢失

#### Scenario: 连续列表不扩大源码范围

- **WHEN** 用户将光标放入中间没有空行的无序或有序列表中的某一直接列表项
- **THEN** 仅该列表项显示可编辑 Markdown 标记，其他列表项继续显示安全渲染结果

#### Scenario: 冲突状态保留双方内容

- **WHEN** Live Preview 编辑期间发生需要人工处理的外部修改冲突
- **THEN** 页面继续提供可编辑本地草稿与外部只读版本的对比及处理入口，不以单一渲染表面隐藏任一方内容

#### Scenario: 依赖只读视图保持专用行为

- **WHEN** 用户查看而非编辑线程的 `## 依赖` 小节
- **THEN** 页面仍将有效序号渲染为线程标题链接并标记悬空引用，Live Preview 不改变该只读交互

### Requirement: Live Preview 的原文保真与安全渲染

Live Preview SHALL 以 Markdown 原文作为唯一提交内容，用户操作 SHALL 直接映射为原文变更，MUST NOT 将渲染 HTML 作为存储或反向序列化来源。插入页面的渲染结果 SHALL 继续经过安全清理。

#### Scenario: 编辑不产生无关格式漂移

- **WHEN** 原文包含 CRLF、末尾换行、列表缩进、转义、原始 HTML 或注释，用户仅修改其中一处文本
- **THEN** 提交内容仅包含对应原文变更，不因渲染或区块切换重排、规范化或丢弃其他内容

#### Scenario: 编辑表面中的恶意内容被清理

- **WHEN** 正在编辑的 Markdown 含脚本、事件属性、危险 URL、iframe 或危险 SVG
- **THEN** 渲染区域不执行脚本或危险导航，不插入未清理 HTML，原文仍可安全编辑

### Requirement: Live Preview 的草稿交互连续性

任务操作和程序化草稿更新 SHALL 通过与用户输入一致的 Markdown 草稿通道生效。程序化更新 SHALL 保留可映射选区，MUST NOT 整体重建编辑上下文、覆盖更新期间的新输入或中断正在进行的输入法组合。

#### Scenario: 点击渲染任务修改原文

- **WHEN** 用户点击 Live Preview 中非活动区块的任务复选框
- **THEN** 仅对应 Markdown 任务标记被切换，嵌套与代码块定位规则保持正确，既有入口沿用各自草稿保存语义

#### Scenario: 新建目标中的任务操作不提前落盘

- **WHEN** 用户在新建线程目标中点击任务复选框但尚未创建线程
- **THEN** 目标草稿中的原文标记被更新，创建前不发生自动保存或线程写请求

#### Scenario: 外部合并期间继续编辑

- **WHEN** 外部无冲突合并或采用外部版本更新编辑器内容时，用户继续输入或进行中文输入法组合
- **THEN** 新输入不被旧内容覆盖，可映射选区保持稳定，编辑器无需整体重建即可显示最新草稿

### Requirement: Live Preview 的源码模式与失败回退

每个 Live Preview 入口 SHALL 提供查看和编辑完整 Markdown 原文的途径。渲染能力不可用或渲染失败时 SHALL 显示可识别错误并回退为可编辑源码，MUST NOT 插入未清理 HTML 或丢弃草稿。

#### Scenario: 源码模式往返保持内容

- **WHEN** 用户从 Live Preview 切换到完整源码模式，编辑后再切回
- **THEN** 切换过程不引入额外格式变化，源码编辑结果继续用于预览和保存

#### Scenario: 渲染失败仍可编辑

- **WHEN** 安全清理组件不可用或 Markdown 渲染失败
- **THEN** 页面显示错误与完整可编辑原文，保留当前草稿及既有保存状态，不展示未经清理的渲染内容

### Requirement: 看板表格的字段化编辑

看板基础表格 SHALL 为每个 schema 字段提供与其类型匹配的单元格编辑能力，并通过同一字段更新协议写回目标卷宗。markdown 字段 SHALL 复用 Live Preview、自动保存和三方合并；select 字段 SHALL 提供选项选择；reference 字段 SHALL 提供线程引用的增删、跳转与悬空显示；file 字段 SHALL 提供路径展示、系统选择器添加、单项移除和只读预览，不提供手输路径入口。编辑失败或冲突时 MUST 保留本地草稿或操作前内容，MUST NOT 静默覆盖外部修改。

#### Scenario: 编辑 Markdown 单元格

- **WHEN** 用户从表格中的 markdown 单元格展开编辑器并修改内容
- **THEN** 页面使用统一 Live Preview 编辑表面自动保存该字段，表格摘要与详情保持一致

#### Scenario: 编辑单选单元格

- **WHEN** 用户在 select 单元格中选择另一配置选项
- **THEN** 仅该字段被更新，非法选项无法通过界面提交，成功后所有相关视图反映新值

#### Scenario: 编辑线程引用单元格

- **WHEN** 用户在 reference 单元格中添加或移除线程引用
- **THEN** 对应序号列表被写回，现有引用可点击跳转，悬空序号保留原始标识

#### Scenario: 编辑文件引用单元格

- **WHEN** 用户通过系统选择器添加合法文件或移除一个既有文件引用
- **THEN** 页面将新路径与现有列表保序合并去重后通过字段更新接口写回，或仅移除目标路径；界面不要求手写路径

#### Scenario: 文件选择后的保存冲突

- **WHEN** 合法选择结果已合并到本地草稿，但字段更新接口返回 409
- **THEN** 页面明确提示文件已被修改，保留本次选择结果和可恢复编辑上下文，不静默覆盖外部版本

#### Scenario: 单元格保存冲突

- **WHEN** 单元格写回时服务端返回 409
- **THEN** 页面明确提示文件已被修改并保留可恢复的编辑上下文，不将失败操作显示为成功

### Requirement: 系统文件选择与项目范围校验

看板 SHALL 通过本地服务调用 Windows 系统文件选择器添加文件，支持多选并以项目根为初始目录。服务 SHALL 仅对已注册项目和合法 file 字段启动选择器，逐项验证选择结果为实际位于项目内的普通文件。合法结果 SHALL 转为 `/` 分隔的相对路径；任一结果无效时 MUST 整批拒绝并返回全部错误路径，取消 MUST 返回空列表且不写盘。

#### Scenario: 选择多个合法文件

- **WHEN** 用户在系统选择器中选择多个实际位于当前项目内的文件并确认
- **THEN** 服务返回按选择顺序排列的项目相对路径，统一使用 `/`，此时尚未修改卷宗

#### Scenario: 混合选择整批拒绝

- **WHEN** 一次选择同时包含项目内文件和一个或多个项目外文件
- **THEN** 服务拒绝整批选择并返回所有越界路径，页面提示本次未添加任何文件，原字段与草稿保持不变

#### Scenario: 无效目标整批拒绝

- **WHEN** 选择结果包含目录、不存在的目标、非普通文件，或符号链接实际指向项目外
- **THEN** 服务拒绝整批选择并给出各无效目标的原因，不返回可供保存的部分成功列表

#### Scenario: 取消系统选择器

- **WHEN** 用户未选择文件而取消系统对话框
- **THEN** 接口返回空路径列表，页面不显示错误、不合并草稿，也不发起字段更新

#### Scenario: 选择器启动或执行失败

- **WHEN** 本地服务无法启动系统选择器，或选择器进程异常结束或返回无法解析的结果
- **THEN** 页面显示明确错误并保留原字段与草稿，不将失败显示为添加成功

#### Scenario: 非受信调用不弹出对话框

- **WHEN** 选择请求指向未注册项目、未知线程、非 file 字段，或未通过同源 JSON 校验
- **THEN** 服务拒绝请求且不启动任何系统对话框

### Requirement: 项目文件只读预览

看板 SHALL 支持按需预览指定线程 file 字段中已登记的路径。服务 MUST 验证项目已注册、路径属于该字段且实际目标为项目内普通文件，仅接受不超过 1 MiB 的有效 UTF-8 文本；`.md` 和 `.markdown` SHALL 安全渲染，其余文本按原文展示。预览 MUST NOT 修改文件、支持编辑或加载 Markdown 引用的本地资源。

#### Scenario: 预览 Markdown 文件

- **WHEN** 用户打开一个已登记且符合限制的项目内 Markdown 文件
- **THEN** 页面按需读取并显示安全渲染结果，原始文件和字段值均不改变

#### Scenario: 预览其他文本文件

- **WHEN** 用户打开一个已登记且符合限制的非 Markdown 文本文件
- **THEN** 页面按原文显示内容，不套用 Markdown 或 HTML 执行语义

#### Scenario: 拒绝任意项目文件读取

- **WHEN** 请求预览的项目未注册，路径未登记在指定线程的指定 file 字段，或字段与路径参数不匹配
- **THEN** 服务拒绝读取并返回明确错误，不返回目标内容

#### Scenario: 拒绝实际越界目标

- **WHEN** 已登记路径包含越界形式，或其符号链接解析后的实际位置在项目外
- **THEN** 服务拒绝读取，不因路径字符串看似位于项目内而返回内容

#### Scenario: 预览缺失文件或目录

- **WHEN** 已登记路径当前不存在、无法访问或指向目录而非普通文件
- **THEN** 页面显示对应错误，其他引用和字段仍可正常使用，服务不崩溃

#### Scenario: 拒绝超限或非文本内容

- **WHEN** 目标超过 1 MiB、不是有效 UTF-8，或包含 NUL 等明确非文本内容
- **THEN** 服务不返回文件正文，页面显示大小或文本格式错误

#### Scenario: Markdown 预览保持安全边界

- **WHEN** Markdown 含脚本、事件属性、危险 URL 或本地图片引用
- **THEN** 页面不执行活动内容、不读取本地图片，并在渲染失败时按既有安全回退显示原文与错误

#### Scenario: 列表加载不批量读取文件

- **WHEN** 表格或详情仅展示文件引用而用户尚未请求预览
- **THEN** 服务不读取被引用文件的正文，页面加载开销不随引用文件大小增长
