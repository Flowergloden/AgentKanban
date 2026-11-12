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
| `codemirror.bundle.mjs` | CodeMirror 6 单文件 bundle（@codemirror/state、@codemirror/view、@codemirror/language、@codemirror/commands、@codemirror/lang-markdown 及其传递依赖） | 见下 | esbuild `--bundle --format=esm --minify` 生成 | MIT（`LICENSE.codemirror.txt`） |

`codemirror.bundle.mjs` 的版本与再生成方式：

- 顶层包固定版本：@codemirror/state 6.7.6、@codemirror/view 6.43.15、@codemirror/language 6.13.1、@codemirror/commands 6.11.1、@codemirror/lang-markdown 6.5.2；实际打入的 21 个包及版本完整记录在 `LICENSE.codemirror.txt` 头部清单。
- 再生成（仅开发维护阶段需要）：在临时目录安装上述固定版本顶层包与 esbuild，以 re-export 这些包全部所需导出的 entry 文件执行 `esbuild entry.js --bundle --format=esm --minify --target=es2020 --legal-comments=none`，替换本文件并同步 `LICENSE.codemirror.txt` 与 `scripts/release.mjs` 的 `web` 清单。
- 该 bundle 不依赖外部模块、不访问 CDN，Node 测试环境可直接 import（`.mjs`）。

说明：

- 以上 ESM 构建均不依赖外部模块，相对导入闭包可通过 `scripts/release.mjs` 的
  `validateRuntimeImports` 校验。
- DOMPurify 在非浏览器环境（如 Node 测试）下 `isSupported === false`，调用方
  必须回退到转义渲染，禁止把未清理 HTML 插入页面。
