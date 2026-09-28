---
description: 在系统默认浏览器中打开当前项目的线程看板
---

以当前会话工作目录的绝对路径为项目根。由本命令文件所在 `commands/` 目录定位 `../server/open.mjs`，执行：

```powershell
node "<本命令目录>/../server/open.mjs" "<项目根绝对路径>"
```

脚本会先确保服务就绪，再以 URL 编码项目根打开浏览器；普通打开不取消常驻。失败时报告 stderr，不得声称打开成功。不要依赖 Kimi 托管安装绝对路径。
