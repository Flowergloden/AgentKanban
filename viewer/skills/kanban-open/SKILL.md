---
name: kanban-open
description: 在系统默认浏览器中打开当前项目的本地线程看板。用户要求查看或打开看板时使用。
---

# 打开看板

1. 从当前会话工作目录取得**项目根绝对路径** `<root>`，不要把插件安装目录当项目根。
2. 从本 `SKILL.md` 所在目录定位 `../../server/open.mjs`，用 Node.js 运行并传入 `<root>` 作为单独参数。例如 PowerShell 中：

```powershell
node "<本技能目录>/../../server/open.mjs" "<root>"
```

脚本先确保共享服务就绪，再编码项目路径并打开浏览器。普通打开不会取消已经选择的常驻模式。若命令退出非零，向用户报告 stderr 的错误；不要声称页面已成功打开。不要读取 `kanban/note.md`。
