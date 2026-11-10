# AGENTS.md

## 发版操作

本仓库唯一的发布入口是 `scripts/publish.mjs`。不要手工改版本号、手工打 tag 或直接 push tag——那会绕过版本同步提交，导致 CI 的 `release.mjs` 版本一致性校验失败。

### 发版步骤

1. 发版前先跑全量测试：`npm test --prefix viewer`（viewer/package.json 的 test 脚本，覆盖 `viewer/test/*.test.mjs`）。
2. 执行 `node scripts/publish.mjs [vX.Y.Z]`：
   - 不带参数时自动取当前版本的下一个 patch 号；
   - 校验 5 个版本文件一致、新 tag 不存在、当前处于分支上（非 detached HEAD）；
   - 将 5 个版本文件与 `viewer/test/*.test.mjs` 中的版本样例同步改写（`publish.test.mjs` 的固定样例除外），提交 `chore(kanban): 版本号更新至 X.Y.Z 并同步测试版本样例`；
   - 打 tag `vX.Y.Z` 并 push 分支与 tag。工作区有未提交更改时脚本会列出并需显式确认才继续，且只会提交版本相关文件，其余更改保持未提交。
3. push tag 后 CI（`.github/workflows/release.yml`）自动完成剩余工作，Release 无需手工创建：
   - `node scripts/release.mjs stage $TAG <临时目录>` 按宿主白名单暂存 kimi / codex / claude 三个包；
   - 分别打包为 `kanban-plugin.zip`（Kimi）、`kanban-codex-plugin.zip`、`kanban-claude-plugin.zip`；
   - 解包后 `node scripts/release.mjs verify $TAG <目录>` 复核三宿主完整性；
   - `gh release create` 上传附件（Release 已存在时退化为 `gh release upload --clobber`）。

### 版本号载体

以下 5 个文件的 `version` 必须保持一致，`publish.mjs` 会自动同步，改版本只走它：

- `kimi.plugin.json`（GitHub 仓库安装入口，引用 `./viewer/` 内资源）
- `viewer/kimi.plugin.json`
- `viewer/.codex-plugin/plugin.json`
- `viewer/.claude-plugin/plugin.json`
- `viewer/service.json`

`viewer/service.json` 的 `protocolVersion` 独立于版本号，仅在服务协议变更时递增，发版时不要顺带改它。

### 本地校验打包（可选）

- `node scripts/release.mjs stage vX.Y.Z <目标目录> [viewer源码目录]`：白名单暂存三宿主包并逐项校验，目标目录必须不存在（拒绝覆盖）。
- `node scripts/release.mjs verify vX.Y.Z <目录>`：复核已打包内容。
- 校验项包括：文件白名单与运行时 import 完整、tag 与 manifest/service 版本一致、hook 脚本引用存在、宿主专属约束（Kimi 的 systemPromptPath/commands/skills 引用、Codex 的 `${PLUGIN_ROOT}` hook、Claude 的 `${CLAUDE_PLUGIN_ROOT}` 与 node+args 形式等）、`SYSTEM.md` 不超过 10000 字符。

### 用户更新路径

用户更新插件 = 直接重装恒定的 latest ZIP URL（`releases/latest/download/` 下的 `kanban-plugin.zip` / `kanban-codex-plugin.zip` / `kanban-claude-plugin.zip`），无需手动结束看板服务进程（v0.2.2 起 ensure.mjs 按版本自动换代）。release notes 中应说明该更新方式。
