# Tasks

## 1. server.mjs：版本可见性与主动退出

- [x] 1.1 服务启动时读取插件 manifest（`../kimi.plugin.json`）的 `version`，`/api/health` 响应携带该版本；验证：启动服务后 `curl http://127.0.0.1:4731/api/health` 返回的 version 与 `viewer/kimi.plugin.json` 一致
- [x] 1.2 新增 `POST /api/shutdown`：先响应 200，再在下一事件循环 tick `process.exit(0)`；验证：调用后接口正常返回、进程退出、4731 端口释放，再次拉起后注册表项目列表完整

## 2. ensure.mjs：cwd 外置与版本换代

- [x] 2.1 spawn 服务进程时显式传 `cwd: os.tmpdir()`；验证：经新 ensure 拉起的服务运行中，对托管目录 `~/.kimi-code/plugins/managed/kanban` 做重命名探测成功（验证后改回），证明目录不再被锁定
- [x] 2.2 复用前比对版本：health 通过但返回版本与本地 manifest 不一致时，先 `POST /api/shutdown`（短超时）并轮询 health 至不可用（约 3 秒上限），再 spawn 新版并复用既有就绪等待与注册逻辑；验证：构造版本不一致场景（如手动改本地 manifest 版本号），新会话启动后健康检查报告的版本更新为本地版本，且全程只有一个服务进程
- [x] 2.3 退化路径：shutdown 请求失败或超时（旧版服务无此端点、health 无版本字段）时退化为直接复用，不报错、不重复 spawn；验证：以 v0.2.1 版服务在线时运行新 ensure，项目注册正常完成且无第二个服务进程

## 3. 发布与实测

- [ ] 3.1 `viewer/kimi.plugin.json` 版本号提升为 0.2.2，release notes 更新路径说明改写为"直接重装恒定 latest URL，无需杀进程"（首次从 0.2.1 升级仍需最后杀一次，单独注明）；验证：release.yml 流水线版本一致性校验通过
- [ ] 3.2 端到端实测：v0.2.2 服务运行中直接覆盖安装同一 latest URL 成功（无 EBUSY）；随后新会话启动触发换代，健康检查报告新版本；验证：两次操作均无需手动杀进程，看板页面功能正常
