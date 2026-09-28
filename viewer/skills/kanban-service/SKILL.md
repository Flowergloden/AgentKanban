---
name: kanban-service
description: 查询或控制线程看板本地共享服务的自动/常驻模式；用户要求常驻、取消常驻、状态或停止时使用。
---

# 看板服务控制

本技能目录的 `../../server/control.mjs` 是统一入口；从本文件位置相对定位，勿使用 Kimi 安装路径。需要 Node.js。操作影响所有项目：

```powershell
node "<本技能目录>/../../server/control.mjs" start --persistent
node "<本技能目录>/../../server/control.mjs" auto
node "<本技能目录>/../../server/control.mjs" status
node "<本技能目录>/../../server/control.mjs" stop
```

启动时若需注册当前项目，可追加 `--root "<项目根绝对路径>"`；不要传插件目录。`start` 不带 `--persistent` 为普通启动，复用现有常驻进程时不降级。`auto`、`status`、`stop` 在未运行时不启动服务。常驻不会注册开机自启；停止不禁用 hooks，后续有效活动仍可启动自动模式。失败时报告 stderr 而非宣称成功。不要读取 `kanban/note.md`。
