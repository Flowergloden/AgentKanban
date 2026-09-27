# 细节优化

status: 实现

<!-- 状态可选值：立项、规划、实现、完成。流转方式：直接修改上一行的 status 值。 -->

## 目标

对当前不合理或有障碍的交互细节进行填补

## 已完成的工作

<!-- 每完成一段工作，在此追加一条记录（含日期与概要）。属于本线程的 OpenSpec change 归档后，其蒸馏总结也追加在这里。 -->

- **2026-09-27** — OpenSpec change `add-kanban-init` 完成并归档。动机：看板服务假设项目已具备完整 `kanban/` 结构，空白项目新建线程报"缺少目录/模板"、活跃切换直接失败，初始化全靠手动。关键决定：新增幂等初始化接口 `POST /api/init` 与内置默认卷宗模板（与仓库模板逐字节一致）；插件 SessionStart hook 与看板页面加载（含切换项目）时自动初始化并给出提示；线程创建/活跃切换在结构缺失时自动补齐而非报错；旧版服务无该接口时页面静默降级。完成情况：11/11 任务完成，delta spec 已同步进主 spec `kanban-viewer`，归档于 `openspec/changes/archive/2026-09-27-add-kanban-init/`。
- **2026-09-27** — 看板工作流松绑 OpenSpec（见上方 `## 决策`）：`kanban/README.md` 概念与操作改写为"OpenSpec change 是可选关联任务（0:N）、小需求一句话记入卷宗"，"关联 change"步骤标注可选；`kanban/templates/thread.md` 注释同步更新；`viewer/server/threads.mjs` 内置默认模板随之更新并保持与仓库模板逐字节一致（静态比对 + `ensureLayout` 落盘实测均一致）；`AGENTS.md` 新增常驻规则：是否创建 OpenSpec change 由用户手动决定，Agent 不得默认路由。主 spec `kanban-threads` 无需改动（其 SHALL 语句未强制 OpenSpec）。
- **2026-09-27** — 新增看板级全局便签 `kanban/note.md`（用户拍板：全局一张、直接实现不走 OpenSpec）：内容仅供人类阅读、不参与工作流——Agent 不读取、不采用（`AGENTS.md` 新增"约定四"）；服务端 `GET/PUT /api/note`（指纹乐观锁、409 冲突、原子写盘），`ensureLayout` 幂等创建带说明头的便签；看板页面头部新增「便签」按钮与编辑模态框（宽模态 + 大文本域 + 冲突重载提示）；`kanban/README.md` 目录结构与概念同步；主 spec `kanban-threads`/`kanban-viewer` 各补一条 Requirement（直接编辑主 spec，未走 change）。已实测：缺失读空不创建、保存落盘、错误指纹 409 不写盘、空白项目 init 创建 note.md 且幂等。

## 决策

<!-- 每条决策 MUST 同时包含"决定了什么"与"为什么"，格式：
- **决定**：……
  **原因**：……
-->

- **决定**：OpenSpec 工作流在 kanban 线程层改为可选路径：小需求一句话直接记入卷宗即可，是否使用 OpenSpec（创建 change）由用户手动决定，Agent 不得默认把需求路由进 OpenSpec。
  **原因**：线程层本质是跨会话笼统目标的容器，强制走 OpenSpec 让小事重流程，违背看板"纯文件、随手记"的定位；需求是否需要 proposal/design/tasks 级别的正式度，应由用户按事情大小自行权衡。

## Changes

<!-- 关联的 OpenSpec change 名字列表（仅登记名字，松耦合引用），例如：
- add-xxx
-->

- add-kanban-init
