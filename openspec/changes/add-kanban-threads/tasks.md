# Tasks

## 1. 目录与模板

- [ ] 1.1 创建 `kanban/` 目录结构（`kanban/threads/`、`kanban/templates/`），验证两个目录存在
- [ ] 1.2 编写 `kanban/templates/thread.md` 模板，包含 `status` 字段（默认 `立项`）与 `## 目标`、`## 已完成的工作`、`## 决策`、`## Changes` 四个必备小节，验证复制该模板即可填写目标投入使用
- [ ] 1.3 创建 `kanban/current` 空文件作为当前线程指针，验证文件存在

## 2. Agent 界面

- [ ] 2.1 在项目根 `AGENTS.md` 写入三条常驻约定（会话开始读 `kanban/current` 指向的卷宗并复述校准；拐点时刻询问是否记录且带防抖约束；归档属于线程的 change 后蒸馏追加到卷宗），验证文本位于 AGENTS.md 中且语义明确可执行
- [ ] 2.2 在 `openspec/config.yaml` 增加 `operations.archive.guidance` 条目（归档完成后若 change 属于某线程则蒸馏追加到其卷宗），验证 YAML 可正常解析且 `openspec list --json` 不受影响正常执行

## 3. 人类界面

- [ ] 3.1 编写 `kanban/README.md` 操作文档，覆盖创建线程（复制模板、填目标）、激活线程（写 `current`）、手动记录（追加小节）、流转状态（改 `status`）、关联 change（登记到 `## Changes`），验证仅按文档用文本编辑器即可完成全部操作

## 4. 端到端自举验证

- [ ] 4.1 用模板为"搭建线程看板"这一目标创建本系统的第一条线程卷宗，将其标识写入 `kanban/current`，并把 `add-kanban-threads` 登记进其 `## Changes`，验证新会话按 AGENTS.md 约定能读到该卷宗
- [ ] 4.2 通读 `kanban/README.md` 并对照实际操作一遍创建/激活/记录/流转流程，验证文档与真实文件结构一致
