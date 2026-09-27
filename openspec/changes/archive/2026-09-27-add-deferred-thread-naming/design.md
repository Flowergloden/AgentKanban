# Design

## Context

看板服务（`viewer/server/`）是零依赖、零配置的纯 Node 本地守护进程，随会话生灭。线程创建时 slug 留空则走 `slugify()`（`viewer/server/threads.mjs`）：仅保留 `[a-zA-Z0-9]`，非英文标题产出为空后 fallback 为固定词 `thread`。创建接口本身已支持调用方显式指定 slug；网页创建模态框也有 slug 选填框。插件通过 `viewer/SYSTEM.md` 向所有项目会话注入四条常驻约定，其中约定一（会话校准）要求 Agent 在会话开始读取 `kanban/current` 指向的卷宗——这是本设计复用的既有触发点。动机见 proposal.md。

## Goals / Non-Goals

**Goals:**

- 非英文标题留空 slug 时可创建成功，且目录名带有明确的"待命名"语义。
- 命名动作由 Agent 在校准时刻自动完成，用户零操作、服务零配置。
- 提供通用的线程重命名接口（同时服务于人工改名历史 `xxxx-thread` 目录）。
- 四条常驻约定的总数与既有 spec 表述不变（命名并入约定一，不新增约定）。

**Non-Goals:**

- 不给看板服务接入任何 LLM/凭据配置。
- 不主动命名非活跃线程；不批量迁移历史 `xxxx-thread` 目录（可经 rename 接口手动改）。
- 不改变 slug 字符集（仍为 ASCII kebab-case，不允许 CJK 入目录名）。
- 本期网页 UI 不提供重命名入口（接口就绪，入口可随时后补）。

## Decisions

### 决策一：延迟命名，Agent 即 LLM

创建时刻不做重活：slugify 无产出时写入标记值占位，命名延迟到会话校准。备选方案及否决理由：

- 服务端直连 LLM：须引入 base URL / API key / model 配置与网络调用、超时、降级逻辑，违背服务零配置定位。
- pinyin 等转写库：引入首个 npm 依赖，且拼音 slug（如 `xi-jie-you-hua`）冗长无语义。
- 创建时由 Agent 显式传 slug：只覆盖 Agent 路径，网页手建中文标题依旧失败。

### 决策二：标记值 `unnamed-pending`，精确匹配，设为保留字

标记值本身须通过 kebab-case 校验（`^[a-z0-9]+(-[a-z0-9]+)*$`）。保留 `unnamed` 主词便于人读与检索，加 `-pending` 后缀降低与用户手填 slug 碰撞的概率。判定用**精确匹配**（id 的 slug 部分 === `unnamed-pending`），不做子串/模式匹配，避免误伤 `my-unnamed-project` 一类正常命名。保留字在两个入口拒绝：创建时显式传入、重命名目标。创建路径的 slug 冲突检查对标记值豁免（序号前缀已保证目录唯一）。

### 决策三：命名并入约定一，而非新增约定五

`kanban-threads` spec 明确"四条常驻约定"，新增约定会牵动该 Requirement。命名在语义上就是校准的一部分（"我理解的当前状态"包含"这条线程还没有名字"），作为约定一的附加步骤注入 `SYSTEM.md`：命中标记 → 生成 slug → 调 rename 接口 → 复述中报告。不询问用户（家政性质、本地可逆），仅处理当前活跃线程（不活跃线程标题可能未稳定，留待激活时再命名更准）。

### 决策四：rename 接口语义

`POST /api/threads/:id/rename`，body `{ slug }`。实现落在 `threads.mjs` 新增 `rename()`：

- 校验：kebab-case、非保留字；冲突检查扫描 `NNNN-slug` 目录时**排除自身**（自身 slug 不变视为合法，直接返回现 id，幂等 no-op）。
- 执行：目录 `rename`（同卷原子操作）；被改名线程为活跃时原子写更新 `kanban/current`，顺序先改目录后写 current。
- 错误：线程不存在 `thread-missing`、slug 非法/保留字 `bad-request`、冲突 `conflict`，复用现有 `ThreadError` 体系与 server 的错误映射。

### 决策五：Agent 侧的失败与并发处理（约定文本要点）

- rename 返回冲突：Agent 换名重试（如追加 `-2`），不阻塞校准。
- 服务不可达或 rename 失败：跳过命名，正常校准复述并附一句说明，下一会话再试。
- 多会话并发命中同一待命名线程：后到者的 rename 收到 `thread-missing`，重读 `current` 后继续，不做重试。

## Risks / Trade-offs

- [约定靠 prompt 注入，Agent 可能不执行] → 后果上限是线程保持待命名，无数据损坏；接口层保留字与校验兜底，网页列表展示标题不受影响。
- [重命名瞬间用户正在看板页面查看该线程] → 页面按旧 id 查询得到明确错误状态（既有行为），刷新即恢复；窗口极短，低危。
- [Windows 上目录被占用（如编辑器打开卷宗）导致 rename 失败] → 接口返回错误，Agent 跳过并在复述中说明，可下一会话重试。
- [线程目录会短暂顶着 `unnamed-pending` 直到下次校准] → 可接受的语义化中间态；标题在 UI 中正常显示。

## Migration Plan

无数据迁移：历史 `xxxx-thread` 目录保持原样，需要时经 rename 接口逐个改名。服务接口向后兼容（新增接口；既有行为变化仅覆盖原先会失败或产出 `thread` 的场景）。`SYSTEM.md` 约定文本随插件版本分发，新版本插件的会话自动获得命名步骤；旧版服务无 rename 接口时 Agent 按决策五降级跳过。
