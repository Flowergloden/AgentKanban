# Vendored 前端依赖

本目录集中存放前端运行所需的官方浏览器 ESM 分发，均为固定版本、自包含文件，
不访问 CDN、不要求用户执行 npm install。新增或升级依赖时须同步更新本表与
`scripts/release.mjs` 的 `web` 清单及许可证文件。

| 文件 | 包 | 版本 | 来源 | 许可证 |
| --- | --- | --- | --- | --- |
| `preact-standalone.module.js` | preact-standalone（preact + htm） | 随本仓库既有 | npm 包 `preact-standalone` | MIT |
| `marked.esm.js` | marked | 18.1.3 | npm 包 `marked` 的 `lib/marked.esm.js` | MIT（`LICENSE.marked.txt`） |
| `purify.es.mjs` | dompurify | 3.4.17 | npm 包 `dompurify` 的 `dist/purify.es.mjs` | Apache-2.0 或 MPL-2.0（`LICENSE.dompurify.txt`、`LICENSE.dompurify-MPL.txt`） |
| `diff3.mjs` | node-diff3 | 3.2.1 | npm 包 `node-diff3` 的 `dist/diff3.mjs` | MIT（`LICENSE.node-diff3.md`） |

说明：

- 以上 ESM 构建均不依赖外部模块，相对导入闭包可通过 `scripts/release.mjs` 的
  `validateRuntimeImports` 校验。
- DOMPurify 在非浏览器环境（如 Node 测试）下 `isSupported === false`，调用方
  必须回退到转义渲染，禁止把未清理 HTML 插入页面。
