---
name: kanban-open
description: 在系统默认浏览器中打开当前项目的看板页面（本地看板服务展示 active thread 原文）。当用户想查看/打开看板，或输入 /kanban:open 时使用。
---

# 打开看板

按以下步骤打开当前项目的看板页面：

1. 取当前会话工作目录的绝对路径作为项目根（下称 `<root>`）。
2. 确认看板服务在运行：`curl -s --max-time 2 http://127.0.0.1:4731/api/health`，应返回 `{"ok":true,"name":"kanban-viewer"}`。
3. 若服务未运行，先拉起：

```bash
echo "{\"cwd\":\"<root>\"}" | node ~/.kimi-code/plugins/managed/kanban/server/ensure.mjs
```

4. 用系统默认浏览器打开看板 URL（`<root>` 必须先做 URL 编码，Windows 路径含反斜杠与冒号）：

```bash
cmd /c start "" "http://127.0.0.1:4731/?root=<URL编码后的root>"
```

5. 打开后页面应显示当前项目 active thread 的 `thread.md` 原文。若服务不可达或页面提示异常，告知用户检查端口 4731 是否被其他程序占用。
