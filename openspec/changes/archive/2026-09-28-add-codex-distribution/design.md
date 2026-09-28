# Design

## Context

动机见 proposal.md。现有 viewer 为无外部服务依赖的 Node.js HTTP 服务和 Preact 页面，固定监听 127.0.0.1:4731。ensure.mjs 读取 stdin.cwd、从 Kimi manifest 获取版本，并在版本不同时请求旧服务退出；server.mjs 仅由 heartbeat 刷新 180 秒 TTL，注册表位于 Kimi 用户目录。打开技能写死 Kimi 托管路径，发布命令排除隐藏文件；仓库目前没有检入的自动化测试或 package.json。

现行 kanban-viewer 将退出绑定会话心跳、版本差异一律换代、约定绑定 systemPromptPath。本次将通过完整 delta 修改这些契约，而不是把 Codex 适配伪装成无行为变化的打包调整。kanban-threads 的文件模型、四条约定、惰性初始化及便签人类专属语义不变。

探索阶段于 2026-09-28 读取的 OpenAI 官方《Package your plugin》《Hooks》说明：兼容清单 .codex-plugin/plugin.json 与 hooks/hooks.json 可用于分发；SessionStart 支持 additionalContext，输入包含 cwd/session_id，插件 hook 可使用 PLUGIN_ROOT；hooks 需要用户信任。事件列表未提供 SessionHeartbeat，因此不设计虚构的周期 hook。实际安装与命令引用仍须在目标 Windows 桌面端和 CLI 验收，不将阅读文档当作运行验证。

## Goals / Non-Goals

**Goals:**
- 共享业务实现，宿主差异限制在 manifest、hooks、入口与发布清单。
- 默认无需人工维护进程；用户显式常驻后不受普通活动或空闲计时干扰。
- 多项目、多会话、两个已升级宿主共用一个服务；不会反复降级或因升级丢失常驻模式。
- 不污染无关仓库、不占用插件目录、不改变用户全局配置。

**Non-Goals:**
- 开机自启、系统服务注册、崩溃守护、后台定时轮询 Codex 内部会话数据库。
- MCP 化、云端托管、官方公共插件目录上架、Linux/macOS 完整认证。
- 修补已安装且未升级的旧 Kimi 客户端；自动迁移或修改线程卷宗内容。

## Decisions

### D1：同一源码根，双宿主清单与白名单打包

保持 viewer 为共享源码根，增加 viewer/.codex-plugin/plugin.json 与 viewer/hooks/hooks.json；共用 SYSTEM.md、server、web、去除宿主绝对路径后的 skills。保留 Kimi manifest、commands，Codex 不依赖 Kimi commands 派发。

仓库 .agents/plugins/marketplace.json 声明 kanban 的仓库内源 viewer；发布说明提供仓库 marketplace 的安装路径和本地检出验证步骤。Kimi 附件仍为 kanban-plugin.zip，Codex 附件为 kanban-codex-plugin.zip；后者只作为可检验的分发归档，不承诺 ZIP URL 直接安装。包采用宿主专用白名单，Codex 包必须保留隐藏清单，两个包不夹带 openspec、项目 kanban 或开发技能。无须复制源码到第二棵维护目录。

新增共享 service 元数据（拟为 viewer/service.json），保存版本和协议版本；发布检查强制 tag、两个 manifest、service 元数据版本一致。协议版本与发布版本分开递增。选择兼容清单而非同时引入 portable manifest，避免本次承担第三种格式与优先级测试。

### D2：Codex 薄 hook 适配，共享约定正文

新增 Codex hook 适配脚本（拟为 viewer/server/codex-hook.mjs）：SessionStart 执行有界 ensure/注册，并独立输出 SYSTEM.md 的 additionalContext；服务不可达仍输出约定，诊断写 stderr，不能混入 JSON stdout。startup/resume 注入，新上下文 compact 也补入同一约定，但补入不新增“每次压缩都重新询问校准”的业务要求。

UserPromptSubmit 和 PostToolUse 作为活动信号；后者覆盖长回合中工具完成后的续期。活动 hook 节流后调用共享 ensure/活动路径，服务空闲退出时能重建；不能把纯心跳请求当成重启能力。Kimi 保留 SessionStart / SessionHeartbeat 接口，升级后的 heartbeat 也使用相同恢复路径。各 hook 具有超时，失败不阻塞用户本来要执行的任务。活动适配须排除本插件服务控制、纯状态/健康探测及其触发的工具完成事件，避免 stop 刚执行就被 PostToolUse 拉起，或只读诊断被间接算成保活；后续真正的用户任务活动仍可恢复。

打开和服务控制 skill 用技能自身路径定位脚本；hooks 用宿主给出的插件根定位。共享脚本用 import.meta.url 定位资源，项目根明确由参数或 hook.cwd 传入，绝不将插件缓存目录误当项目。Windows 路径空格、中文、反斜杠的引用必须实测。只读健康检查不触发初始化，启动注册也不创建 kanban。

不选择项目 AGENTS.md 托管块：此前已明确插件是约定单一来源；不选择仅靠 skill 注入：无法保持会话启动阶段的校准入口。

### D3：以活动计时而不是模拟会话存活

状态为 auto 或 persistent，默认 auto。有效注册、会话活动、Kimi heartbeat、成功的看板业务交互与可见页面续期更新 lastActivityAt。可见页面每约 60 秒发送活动请求，变为可见时立即发送；页面隐藏后不定时续期。GET /api/health 和只读服务状态查询不得刷新活动时间，避免诊断工具意外保活。

auto 模式连续 180 秒无活动后，在下一次清理检查中退出（保留约 30 秒检查周期）；persistent 完全跳过 TTL。浏览器休眠或后台节流、无工具完成的长时间生成可能超过期限，这是活动驱动的明确边界；后续 hook 或本地打开入口恢复。已失联的网页仅提示重新使用打开入口，不能承诺 HTTP 请求启动本地进程。需要持续可用时用户选择常驻。

拟增加 POST /api/activity，保留 POST /api/heartbeat 为兼容活动入口。项目 lastSeen 仅在带有效 root 的活动中更新；缺少 root 的合法服务活动不制造项目记录。无效请求不续期。

### D4：显式常驻是进程模式，不是永久用户偏好

新增统一脚本 viewer/server/control.mjs，规划操作为 start --persistent、auto、status、stop；start 默认 auto，但复用已运行服务时不将 persistent 降为 auto。参数 root 与进程 cwd 分离。常驻启动不强制打开浏览器、不初始化项目、不依赖 Agent，可从任意目录执行。

健康检查扩展 mode、protocolVersion；新增 POST /api/service/mode 接受 auto/persistent，原子切换模式。auto -> persistent 不重启，persistent -> auto 将 lastActivityAt 重置为当前时间。无服务时 auto、status、stop 返回明确的未运行状态，不为了取消或停止反而启动服务；重复 start/stop 幂等。

显式 stop 复用 shutdown，提示影响所有项目；它停止当前进程，不是禁用插件。未来新会话活动仍可按默认 auto 启动，因此说明“若要持续停用需禁用入口/hook”。前端显示模式并提供常驻/取消常驻控制；手动停止入口须明确影响范围，页面操作停止时先确认，脚本 stop 本身视为显式意图。

常驻不写入永久首选项；正常停止、异常终止或系统重启后，普通启动回到 auto。仅一次协调升级可以传递模式：启动器持锁读取旧 mode，在旧服务成功退出后通过启动参数交给新服务；不使用会在重启后误恢复的永久标记。

### D5：共享端口的安全复用与升级协商

保留单一 4731 服务。ensure/控制操作通过共享用户目录的短期互斥锁串行化关键操作，锁内重读 health，竞争失败者等待并复查；实现有界等待、进程归属校验及遗留锁清理。服务替换与模式写入需串行，升级期间模式请求返回可重试状态，防止读取旧模式之后用户改变模式而被覆盖。

- 当前服务协议兼容且发布版本相同或更新：复用，不降级。
- 本地发行版本更新且协议兼容：协调换代，保留 mode、项目注册表；失败明确报告，不能声称升级成功。
- 协议不兼容或版本无法安全比较：不自动杀掉现有服务，返回两端升级/显式迁移指引。
- 旧服务未携带协议：普通打开可在旧 API 可用时降级复用并提示；常驻控制不得伪装成功。用户停止旧服务、升级两端后再启用新协议。
- 非 kanban 服务占用端口：不发送 shutdown、不杀进程，报告冲突。

旧 Kimi ensure 会对任意版本差异主动 shutdown，新服务无法阻止其请求且同时保持旧退出协议；不承诺新旧宿主版本任意混搭。避免在旧客户端不支持的情况下设计虚假的防降级保障。完整共存验收使用双方支持新协议的版本。

### D6：宿主无关注册表与非破坏性导入

共享数据目录默认 ~/.agent-kanban，支持显式 AGENT_KANBAN_HOME 覆盖；两个宿主默认使用同一位置，不使用不同插件缓存的 PLUGIN_DATA 作为共享注册表。仅首次缺少新 registry 时导入 KIMI_CODE_HOME/kanban-viewer/registry.json，未设置 KIMI_CODE_HOME 时读取 ~/.kimi-code/kanban-viewer/registry.json；新目录已存在有效数据时不被旧数据覆盖。

导入只读旧文件，路径归一化、去重保留较新 lastSeen，原子写入新文件；导入损坏或写入失败保留源文件并报清晰诊断，不截断已有数据。锁与 registry 放共享目录，服务 cwd 继续为 os.tmpdir()，不锁定插件安装目录。

### D7：验收按“可安装、可运行、可共存”分层

采用 Node 内置测试能力，不引入测试框架依赖。状态机通过可注入时钟验证边界，子进程集成测试隔离数据目录/测试端口且清理自身进程，不连接正在使用的 4731。构建检查解包验证双包文件树与版本，缺清单立即失败。

实际宿主验证单独记录：Codex 桌面端和 CLI 安装、信任 hooks、新开/恢复聊天、压缩后约定、带空格路径与常驻控制；Kimi 原入口及新版本共存回归。无法获得目标宿主时将该验收留为未完成，而非用静态检查代替。

## Risks / Trade-offs

- [活动驱动不等于会话存活] -> 明确长回合、页面休眠的恢复边界，提供常驻模式。
- [插件 hooks 更新后需重新信任] -> 安装说明显式列出信任步骤，验证未信任时不宣称自动能力可用，不绕过信任。
- [旧 Kimi 客户端仍能请求新服务退出] -> 完整共存要求两端升级；不擅自强杀旧进程或篡改旧安装目录。
- [活动事件频繁或并发升级造成竞争] -> 节流、共享锁、二次 health 检查、模式与换代串行化、失败有界。
- [新增服务控制扩大本地 HTTP 写操作] -> 延续回环监听，模式写接口限制 JSON 与同源浏览器请求，不开放宽泛 CORS，不将任意网页请求视为用户控制意图；不扩展为全面认证重构。
- [共享注册表位置变化] -> 非破坏性导入与旧文件保留，明确回滚后新注册的项目不会自动回写旧目录。

## Migration Plan

1. 完成共享运行层、双宿主适配、测试和打包检查，使用临时目录与临时端口验证，不在测试中停止用户服务。
2. 发布前验证 tag 与三个版本来源一致；同时产出保留原名的 Kimi 包和 Codex 包，marketplace 源能获取全部运行资源。
3. 现有用户显式停止旧服务，升级 Kimi，再安装 Codex 并信任 hooks；首次启动按需导入注册表。单用 Codex 的新用户不依赖 Kimi 安装。
4. 验证自动恢复、常驻切换、取消、停止、两端版本差异复用及常驻升级继承。常驻启动本身不代表同意开机自启。
5. 回滚时先显式停止新服务，禁用/移除 Codex 入口，再安装旧 Kimi 包；旧注册表仍保留，新注册表也不删除。需要回滚后新增项目时显式重新注册，不自动双向同步。
