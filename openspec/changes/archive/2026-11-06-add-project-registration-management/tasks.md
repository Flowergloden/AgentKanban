# Tasks

## 1. 注册表模型与迁移

- [x] 1.1 在 `viewer/server/registry.mjs` 为条目增加三态字段与旧数据默认 `registered` 迁移，补充数字条目、无状态对象、三态 round-trip、重启保留及写失败保留源数据测试，运行 `node --test test/registry.test.mjs` 验证。
- [x] 1.2 统一新输入的绝对路径规范化与 Windows 别名合并，同时保留旧相对路径的兼容读取；补充分隔符、尾斜杠、`.` 片段、大小写及中文空格路径测试，运行注册表测试验证无重复别名。

## 2. 自动发现与项目管理接口

- [x] 2.1 在服务端实现复制注册表、原子落盘后再提交内存状态的写助手，并接入自动发现；通过注入写失败验证磁盘与内存均不改变。
- [x] 2.2 修改 register/activity/heartbeat 的自动发现语义，使新路径为 pending、registered 仅刷新 lastSeen、ignored 不改项目记录但仍续期服务；在 `viewer/test/lifecycle.test.mjs` 和双宿主测试中覆盖重复上报与状态保持。
- [x] 2.3 实现项目 confirm、手动新增、ignore、delete 接口及同源 JSON 校验，手动新增验证现存目录；新增接口测试覆盖全部状态流转、无效路径、重复新增、原子持久化、跨域/非 JSON 拒绝和删除不动项目文件。
- [x] 2.4 扩展项目列表投影携带 state 并保持 vcs 字段，通过接口测试验证三种状态均可管理且主列表所需的 lastSeen 排序数据完整。

## 3. 已注册门控与 VCS 行为

- [x] 3.1 为初始化及所有可能写入 `kanban/` 的服务端接口增加统一的 registered 门控，覆盖 pending、ignored、未登记路径的直接 API 请求，验证返回明确错误且文件系统无变化。
- [x] 3.2 保留已注册项目初始化幂等及写操作缺结构自动补齐，更新既有初始化、线程、活跃切换、便签和 VCS 测试夹具以先显式确认项目，并运行对应测试验证正常路径不回归。
- [x] 3.3 将 P4 检测限定为确认成功及已注册项目加载/刷新，使用 `viewer/test/p4-shim.mjs` 验证 pending/ignored 零 p4 调用、确认后检测缓存及已有 P4 写路径不变。

## 4. OpenKanban 显式确认与兼容

- [x] 4.1 为 `viewer/server/manager.mjs` 增加显式确认选项并让 `open.mjs` 在确认成功后打开浏览器，普通 ensure、控制启动和活动恢复仍只自动发现；通过 `open.test.mjs`、`control.test.mjs` 与活动测试验证状态差异。
- [x] 4.2 覆盖新入口对旧协议服务的降级及旧入口对新版服务仅产生 pending 的兼容场景，验证可复用服务、不误报确认成功、模式保留且确认失败不打开浏览器。
- [x] 4.3 更新 `viewer/commands/open.md`、`viewer/skills/kanban-open/SKILL.md` 中显式打开即确认的说明，核对命令参数和失败语义与实现一致。

## 5. Web 项目管理与显式初始化

- [x] 5.1 扩展 `viewer/web/api.js` 和项目状态投影，主选择器仅展示 registered；为状态过滤、最近项目选择及 root 规范化补充可运行测试或纯逻辑测试。
- [x] 5.2 实现项目管理模态框，按 pending/registered/ignored 分区提供新增、确认、忽略、取消忽略和删除，展示操作错误及删除/忽略差异；验证手动新增不自动切换或初始化。
- [x] 5.3 移除页面加载时无条件 init，改为已注册无 `kanban/` 项目的初始化/忽略视图；验证待确认、已忽略、未知 URL 不自动注册、不初始化，页面活动对未知 URL 不携带 root。
- [x] 5.4 实现删除或忽略当前项目后的下一项目/空状态导航与 `history.replaceState`，验证刷新不会恢复已移除 root；初始化成功后保留既有 P4 add 询问流程。
- [x] 5.5 在 `docs/manual-acceptance.md` 增加三态管理、显式 OpenKanban、无结构项目选择、当前项目删除/忽略及旧数据清理验收项，确保每项可记录实际证据。

## 6. 集成验证

- [x] 6.1 在隔离端口和临时 `AGENT_KANBAN_HOME` 下执行自动发现→Web 确认/忽略→显式 OpenKanban→初始化→删除/再发现的端到端场景，核对 API、浏览器展示、注册表和项目文件，确保不触碰真实注册表。
- [x] 6.2 运行 `cd viewer && npm test` 全套测试及 `openspec validate add-project-registration-management --strict`，修复本 change 引入的问题并核对最终状态与 spec delta 覆盖一致。
