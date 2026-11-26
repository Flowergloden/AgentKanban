# 文件引用

status: 完成

<!-- 线程生命周期。 可选值：立项、规划、实现、完成。 -->

## 目标

<!-- kanban:field=goal -->
<!-- 创建时填写：这条线程要达成的笼统目标（如实现某模块、验证某想法）。 -->

新增文件引用 type，用以引用本地路径上的文件

## 已完成的工作

<!-- kanban:field=completed -->
<!-- 每完成一段工作，在此追加一条记录（含日期与概要），小需求一句话即可，无需关联 change。若使用 OpenSpec：属于本线程的 change 归档后，其蒸馏总结也追加在这里。 -->

- 2026-11-25：完成 file 字段、项目相对路径与真实路径校验、WinForms 多选、活动租约、受控只读预览及四类型前端分派；全量 277 项测试、OpenSpec strict、三宿主 stage/verify 和真实 Windows 多选/取消/越界/中文路径/190 秒保活/移除/409 验收通过。
- 2026-11-25：归档 change `add-file-reference-type`。动机：schema 驱动卷宗缺少类型化的项目文件引用入口，需要以可移植的项目相对路径稳定定位文件，并通过系统选择器与受控只读预览降低手工录入和查阅成本。关键决定：file 字段保存有序、去重、`/` 分隔的项目相对路径列表，默认 schema 不新增核心字段；系统选择器（PowerShell STA + WinForms）只返回候选路径，字段保存仍走既有指纹/409/P4 字段更新协议；预览以字段成员资格加 realpath 双重收敛，限 1 MiB 有效 UTF-8 文本，文件 Markdown 预览禁止图片；以活动租约保证选择对话框打开期间 auto 服务不空闲退出。完成情况：19/19 任务完成，全量测试、OpenSpec strict、三宿主 stage/verify 与 Windows 端到端验收通过，delta 已同步至 kanban-threads 与 kanban-viewer 主规格。
- 2026-11-25：定位并修复生产环境「选择文件」点击后卡在「处理中」：无参 `ShowDialog()` 从后台服务进程弹出时受 Windows 前台锁限制被压在窗口下层，且无任务栏按钮与 Alt+Tab 入口，对话框不可达、选择请求挂起；改为以 TopMost 隐藏 owner Form 作为 `ShowDialog($owner)` 的 owner 强制置顶。真实桌面验证新对话框 TopMost 且 Visible、取消返回空列表；file-picker 测试通过，全量 272/277，5 项符号链接失败为本机既有环境问题（基线 6 项失败含同组），与本次改动无关。

## 决策

<!-- kanban:field=decisions -->
<!-- 每条决策 MUST 同时包含“决定了什么”与“为什么”，格式：
- **决定**：……
  **原因**：…… -->

- **决定**：系统文件选择器对话框以 TopMost 的隐藏 owner Form 作为 `ShowDialog($owner)` 的 owner 弹出，不再使用无参 `ShowDialog()`。
  **原因**：看板服务是无前台权限的后台进程，无参 `ShowDialog()` 弹出的对话框会被 Windows 前台锁压在 z-order 底部，既无任务栏按钮也不在 Alt+Tab 中，用户无法感知与操作，选择请求一直挂起、页面按钮停在「处理中」；TopMost owner 使对话框稳定置顶可见，且改动只限于 picker 脚本模板，协议与校验逻辑不变。

## Changes

<!-- kanban:field=changes -->
<!-- （可选）关联的 OpenSpec change 名字列表，仅当本线程使用 OpenSpec 工作流时才登记；不使用时留空即可。一行一条（仅名字，松耦合引用），例如：
- add-xxx -->
- add-file-reference-type

## 依赖

<!-- kanban:field=dependencies -->
<!-- （可选）本线程依赖的其他线程：纯序号、一行一条，仅记录关系，不约束状态流转或完成。 -->

## 文档

<!-- kanban:field=docs -->

