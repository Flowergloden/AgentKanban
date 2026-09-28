# plugin-distribution Specification

## Purpose

为 AgentKanban 提供共享业务核心的 Kimi 与 Codex 双宿主插件分发，明确可安装产物、版本校验、宿主适配、升级与共存边界，使用户无需复制项目工作流文件即可安装、更新和使用看板。

## Requirements

### Requirement: 双宿主可安装分发

发布 SHALL 保留 Kimi 的 kanban-plugin.zip 附件名称及插件入口，并提供 Codex 兼容清单、hooks、skills、共享服务资源和仓库 marketplace 安装源。Codex SHALL 在没有 Kimi 安装的 Windows 本地桌面端和 CLI 中独立工作。Codex 归档 SHALL 命名为 kanban-codex-plugin.zip，作为可校验的配套产物；安装说明 MUST NOT 把未验证的 ZIP URL 安装描述为可用能力。两个产物 MUST NOT 混入项目 kanban、openspec 或开发技能，Codex 产物 MUST 包含隐藏插件清单。

#### Scenario: 无 Kimi 的 Codex 用户安装
- **WHEN** 用户通过文档中的仓库 marketplace 路径安装 Codex 插件并完成必要信任
- **THEN** 新会话可发现打开和服务控制入口，运行不读取 Kimi 的安装缓存

#### Scenario: 现有 Kimi 用户继续安装
- **WHEN** 用户通过原 kanban-plugin.zip 附件路径获取新版
- **THEN** ZIP 根含 Kimi 清单，原打开入口可用，不被替换成 Codex 包

#### Scenario: 检查 Codex 分发归档
- **WHEN** 解压发布的 Codex 包
- **THEN** 存在 .codex-plugin/plugin.json、hooks 配置、skills 与全部共享运行资源，不包含开发项目数据

### Requirement: 发布版本和资源完整性校验

发布流水线 SHALL 校验 tag、两个宿主 manifest 与共享服务版本一致，按宿主白名单打包，并检查清单引用和入口脚本均位于产物内部。任一版本或文件校验失败 MUST 在上传前终止发布。两端 SHALL 使用同一业务源码与约定正文，协议版本独立于发布版本管理。

#### Scenario: 一致版本发布
- **WHEN** tag 与三个版本来源一致且资源完整
- **THEN** 同一 Release 可获得两个正确命名的宿主产物

#### Scenario: 版本或文件缺失
- **WHEN** 任一版本不匹配，或 Codex 隐藏清单、hooks/skill 引用文件缺失
- **THEN** 流水线失败，不上传缺陷分发包

### Requirement: 安装升级与共存边界可操作

文档 SHALL 给出 Windows 本地 Codex 桌面端及 CLI 的仓库安装、hook 信任、新会话验证、更新、常驻控制和回滚步骤，并明确 Node.js 前置条件。不支持新协议的旧 Kimi 客户端与新版服务混用 MUST 标为迁移状态，完整共存 SHALL 要求两端升级。文档 SHALL 说明关闭旧服务并升级双方的顺序、注册表非破坏性导入、常驻不等于开机自启及停止不等于禁用插件。更新 MUST NOT 自动修改用户全局配置或项目 AGENTS.md。

#### Scenario: 首次启用前审核 hooks
- **WHEN** 用户刚安装或更新后的 hooks 尚未获得信任
- **THEN** 安装说明引导审核信任，不宣称自动启动与约定注入已经生效，不提供绕过信任的安装动作

#### Scenario: 旧 Kimi 迁移到双宿主
- **WHEN** 用户按文档停止旧服务、升级 Kimi 并安装 Codex
- **THEN** 新服务导入原注册表，双方可共用服务，文档明确未升级旧客户端可能继续触发退出

#### Scenario: 回滚保留数据
- **WHEN** 用户停止新版并禁用 Codex 后回装旧 Kimi 插件
- **THEN** 原注册表和新共享注册表均保留，文档说明新版新增注册项目不会自动回写旧表
