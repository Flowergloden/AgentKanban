# Tasks

## 1. 服务端：线程读写模块（`viewer/server/threads.mjs`）

- [x] 1.1 实现卷宗解析（按 `## ` 切分小节、提取首行标题与 `status:` 行、宽容处理缺漏）——用临时脚本对 `kanban/threads/0001`、`0002` 真实卷宗运行，输出的标题/status/四小节内容与文件一致
- [x] 1.2 实现线程列表投影（标识、标题、status、mtimeMs、活跃标记、`## 目标` 摘要、卷宗缺失/异常标记）——对本项目运行，返回两条线程且 `0002` 标记为活跃
- [x] 1.3 实现小节更新（内容 SHA-256 指纹校验、仅替换目标小节正文、tmp+rename 原子写）——脚本验证：指纹匹配时目标小节更新且文件其余部分逐字节不变；指纹不匹配时不写盘
- [x] 1.4 实现 status 流转（仅接受立项/规划/实现/完成）、线程创建（分配下一个序号 id、slug 生成与冲突检测、套用模板）、线程删除（真删目录；删活跃线程时清空 `kanban/current`）、活跃设置/取消——脚本逐项验证文件结果

## 2. 服务端：API 与静态托管

- [x] 2.1 新增 `GET /api/threads`、`GET /api/thread` 路由——`curl` 验证列表字段齐全、详情含四小节与 fingerprint、缺卷宗线程返回明确状态
- [x] 2.2 新增 `PUT /api/thread/section`（409 冲突）、`POST /api/thread/status`（非法值报错）——`curl` 验证：正确指纹更新成功并返回新指纹；脏指纹返回 409 且文件不变；非法 status 返回错误
- [x] 2.3 新增 `POST /api/threads`、`DELETE /api/thread`、`POST /api/active-thread`（写）——`curl` 验证创建套用模板、删除活跃线程后 `kanban/current` 为空、设置/取消活跃正确写 `current`
- [x] 2.4 静态托管扩展为托管 `viewer/web/` 整目录（路径防逃逸 + content-type 映射 html/js/css）——浏览器可加载 `/app.js` 与 `/vendor/` 下文件，既有 `/` 行为不变
- [x] 2.5 既有接口回归——`/api/health`、`/api/register`、`/api/heartbeat`、`/api/projects`、`/api/active-thread`(GET) 行为与首版一致（对照 archived change 的验证记录）

## 3. 前端基座

- [x] 3.1 vendor `htm/preact/standalone.module.js` 到 `viewer/web/vendor/`（文件头注释来源 URL 与版本）——页面 `import` 成功，DevTools 无 404
- [x] 3.2 重写 `index.html` + 新建 `app.js`、`api.js`：App 壳（项目切换下拉、视图标签页、新建线程按钮）、`?root=` 初始化逻辑——无参数打开落到 lastSeen 最近项目，带参打开定位对应项目，行为与现版一致

## 4. 三个内置视图

- [x] 4.1 表格视图（标识/标题/status/最近更新列、活跃标识、点击进入详情）——页面展示与 `kanban/threads/` 实际内容一致
- [x] 4.2 看板视图（四状态分列、卡片拖拽换列调用 status 接口、失败回滚重拉）——拖拽"立项"卡片到"实现"列后，对应卷宗 status 字段变为 `实现`
- [x] 4.3 未完成视图（复用表格 + status≠完成 过滤）——已完成线程不出现在该视图

## 5. 线程详情页

- [x] 5.1 详情读取与展示（标题、status、活跃标识、四小节 markdown 原文，不渲染）——显示内容与 `thread.md` 一致
- [x] 5.2 分小节编辑：`## 目标` 单击即进编辑态；`## 决策`/`## 已完成的工作`/`## Changes` 默认只读、点"编辑"解锁；编辑态为 textarea + 保存/取消——保存后卷宗仅目标小节变化，其余部分（含模板注释）不变
- [x] 5.3 409 冲突横幅（"文件已被修改" + 重新加载入口，不静默覆盖）——用外部编辑制造脏指纹后保存，页面出现横幅且文件未被覆盖
- [x] 5.4 详情页入口：设置/取消活跃、status 流转下拉——操作后 `kanban/current` 与卷宗 status 正确更新，视图同步反映

## 6. 创建与删除入口

- [x] 6.1 新建线程弹窗（标题必填、slug 选填校验 kebab-case、留空自动生成）——创建成功跳转详情页，`kanban/threads/` 出现新目录且卷宗套用模板
- [x] 6.2 删除入口（普通线程一次确认；活跃线程追加二次确认并明示将取消活跃）——删除后目录移除、列表刷新；删活跃线程后 `kanban/current` 为空

## 7. 端到端验证与收尾

- [x] 7.1 桌面端内置浏览器面板实测全链路：项目切换、三视图切换、拖拽流转、详情编辑（含锁定小节解锁）、创建、删除（含活跃二次确认）、409 冲突、无活跃线程提示——逐项通过
- [x] 7.2 多写者场景实测：页面编辑某线程期间由 Agent 按约定追加另一小节，页面保存时收到 409 横幅而非互相覆盖
- [x] 7.3 `openspec validate add-thread-management --strict` 通过，delta spec 与实现行为一致
