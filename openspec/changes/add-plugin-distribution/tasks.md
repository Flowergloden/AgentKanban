# Tasks

## 1. 插件承载约定

- [x] 1.1 新建 `viewer/SYSTEM.md`：以全局条件式措辞写入四条常驻约定（开头守卫"项目根存在 `kanban/` 时适用，否则不动作且不创建结构"），逐条对照现行 AGENTS.md 约定核对触发条件与防抖约束无漂移；验证：文本包含四条约定与守卫段，全文小于 32KB
- [x] 1.2 更新 `viewer/kimi.plugin.json`：新增 `"systemPromptPath": "./SYSTEM.md"`，`version` 改为 `0.2.0`，`description` 改为 kanban 工作流载体定位；验证：`/plugins info kanban`（重装后）无诊断错误，新会话系统提示词包含约定内容

## 2. 惰性初始化

- [x] 2.1 修改 `viewer/server/ensure.mjs`：删除对 `/api/init` 的调用及 `INIT_URL` 常量与相关注释，保留服务拉起与 `/api/register`；验证：在无 `kanban/` 的临时项目中启动会话 hook（`echo '{"cwd":"<临时目录>"}' | node viewer/server/ensure.mjs`），服务就绪、项目已注册、临时目录下未创建 `kanban/`
- [x] 2.2 回归验证惰性补齐：在同一临时项目中调用创建线程接口与页面加载，确认 `kanban/` 结构被自动补齐且功能正常

## 3. 仓库清理

- [x] 3.1 删除仓库根 `AGENTS.md`（全文即四条约定，已迁入插件）；验证：文件不存在，本仓库新会话的校准行为由插件 systemPrompt 接管
- [x] 3.2 更新 `kanban/README.md` 的「Agent 侧约定（摘要）」一节：改为指向插件 `SYSTEM.md`；验证：README 中不再把 AGENTS.md 描述为约定载体
- [x] 3.3 更新主 spec `openspec/specs/kanban-viewer/spec.md` 的 Purpose：反映插件作为 kanban 工作流载体的扩展职责；验证：`openspec validate` 通过

## 4. 发布流水线

- [x] 4.1 新建 `.github/workflows/release.yml`：`v*` tag 触发；校验 tag 版本与 `viewer/kimi.plugin.json` 的 `version` 一致（不一致则失败）；在 `viewer/` 目录内打包 `kanban-plugin.zip`；`gh release create` 上传附件；验证：workflow 语法有效（`gh workflow view` 或 actionlint），zip 内 `kimi.plugin.json` 位于根
- [ ] 4.2 发布首个版本：确认 manifest 为 `0.2.0`，推送 `v0.2.0` tag；验证：Action 成功，release 页面存在 `kanban-plugin.zip` 附件，且 `releases/latest/download/kanban-plugin.zip` 可下载

## 5. 安装切换与端到端验收

- [ ] 5.1 本机切换安装源：`/plugins remove kanban` 后以 release URL 重新安装；验证：`installed.json` 中 kanban 的 source 变为 zip-url，新会话看板服务、页面、skill 入口均正常
- [ ] 5.2 实测 zip-url 安装的更新检测行为（发一个 0.2.1 或重装观察管理器是否提示可更新），把结论写进 release notes；验证：发布说明中包含明确的更新路径说明
- [ ] 5.3 端到端确认 spec 行为：看板项目（本仓库）会话校准/拐点询问正常；无 `kanban/` 的项目不被创建结构、无看板动作；归档属于线程的 change 时蒸馏仍被提示；验证：上述场景各实测一次
