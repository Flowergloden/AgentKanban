---
description: 在系统默认浏览器中打开当前项目的看板页面
---

请按以下步骤打开当前项目的看板页面：

1. 用当前会话工作目录的绝对路径作为项目根（下称 `<root>`），先确认看板服务在运行：请求 `http://127.0.0.1:4731/api/health`，应返回 `{"ok":true,"name":"kanban-viewer"}`。
2. 若服务未运行，先拉起（Git Bash 下执行，插件安装在用户目录的 managed copy）：

```bash
echo "{\"cwd\":\"<root>\"}" | node ~/.kimi-code/plugins/managed/kanban/server/ensure.mjs
```

3. 用系统默认浏览器打开看板 URL（`<root>` 必须先做 URL 编码，Windows 路径含反斜杠与冒号）：

```bash
cmd /c start "" "http://127.0.0.1:4731/?root=<URL编码后的root>"
```

打开后页面应显示当前项目 active thread 的 `thread.md` 原文。若浏览器显示服务不可达或提示异常，告知用户检查端口 4731 是否被其他程序占用。
