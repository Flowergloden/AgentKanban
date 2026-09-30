import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const sourceDefault = path.join(repo, 'viewer');
const server = [
  'activity.mjs', 'control.mjs', 'lifecycle.mjs', 'lock.mjs', 'manager.mjs',
  'metadata.mjs', 'open.mjs', 'registry.mjs', 'server.mjs', 'threads.mjs', 'vcs.mjs',
].map((name) => `server/${name}`);
const web = [
  'api.js', 'app.js', 'detail.js', 'index.html', 'modals.js', 'service-controls.js',
  'views-board.js', 'views-table.js', 'visibility.js',
  'vendor/preact-standalone.module.js',
].map((name) => `web/${name}`);
const skills = ['kanban-open', 'kanban-service'].map((name) => `skills/${name}/SKILL.md`);
const shared = ['SYSTEM.md', 'service.json', ...server, ...web, ...skills];
export const filesFor = (host) => host === 'kimi'
  ? [...shared, 'kimi.plugin.json', 'server/ensure.mjs', 'server/heartbeat.mjs', 'commands/open.md']
  : host === 'codex'
    ? [...shared, '.codex-plugin/plugin.json', 'hooks/hooks.json', 'server/codex-hook.mjs']
    : (() => { throw new Error(`unknown host ${host}`); })();

async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function listedFiles(root) {
  const found = [];
  async function walk(dir, prefix = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else { assert(entry.isFile(), `not a regular file: ${relative}`); found.push(relative); }
    }
  }
  await walk(root);
  return found.sort();
}

async function validateRuntimeImports(root, included) {
  for (const relative of included.filter((name) => /\.(m?js)$/.test(name))) {
    const content = await fs.readFile(path.join(root, relative), 'utf8');
    for (const match of content.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
      assert(included.includes(resolved), `${relative} imports missing ${resolved}`);
    }
  }
}

export async function verifyPackage(root, host, tag) {
  assert(/^v\d+\.\d+\.\d+$/.test(tag), `invalid release tag ${tag}`);
  const included = filesFor(host);
  const actual = await listedFiles(root);
  assert(JSON.stringify(actual) === JSON.stringify([...included].sort()),
    `${host} package files differ: missing=${included.filter((name) => !actual.includes(name)).join(',')} extra=${actual.filter((name) => !included.includes(name)).join(',')}`);
  const service = await json(path.join(root, 'service.json'));
  const manifest = await json(path.join(root, host === 'kimi' ? 'kimi.plugin.json' : '.codex-plugin/plugin.json'));
  assert(manifest.version === tag.slice(1) && service.version === tag.slice(1),
    `${host}: tag/manifest/service version mismatch`);
  assert(Number.isSafeInteger(service.protocolVersion) && service.protocolVersion > 0,
    'protocolVersion must be an independent positive integer');
  assert(manifest.name === 'kanban', `${host}: wrong plugin name`);
  await validateRuntimeImports(root, included);
  if (host === 'kimi') {
    for (const ref of [manifest.systemPromptPath, manifest.commands, manifest.skills]) {
      assert(typeof ref === 'string' && ref.startsWith('./'), `invalid Kimi manifest reference ${ref}`);
      await fs.stat(path.join(root, ref));
    }
    for (const hook of manifest.hooks) {
      const target = hook.command.match(/\.\/server\/([\w-]+\.mjs)/)?.[0];
      assert(target && included.includes(target.slice(2)), `missing Kimi hook script ${hook.command}`);
    }
  } else {
    for (const ref of [manifest.skills, manifest.hooks]) {
      assert(typeof ref === 'string' && ref.startsWith('./'), `invalid Codex manifest reference ${ref}`);
      await fs.stat(path.join(root, ref));
    }
    const hooks = await json(path.join(root, manifest.hooks));
    for (const groups of Object.values(hooks.hooks)) for (const group of groups) for (const hook of group.hooks) {
      const target = hook.command.match(/\$\{PLUGIN_ROOT\}\/server\/([\w-]+\.mjs)/)?.[1];
      assert(target && included.includes(`server/${target}`), `missing Codex hook script ${hook.command}`);
    }
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse'])
      assert(Array.isArray(hooks.hooks[event]) && hooks.hooks[event].length > 0, `missing Codex ${event} hook`);
  }
  for (const skill of skills) {
    const content = await fs.readFile(path.join(root, skill), 'utf8');
    for (const match of content.matchAll(/\.\.\/\.\.\/server\/([\w-]+\.mjs)/g))
      assert(included.includes(`server/${match[1]}`), `${skill} references missing ${match[1]}`);
  }
  return { host, version: service.version, files: actual.length };
}

export async function stageRelease(source, dest, tag) {
  // Fail before creating release artifacts on mismatched versions or missing source resources.
  const kimi = await json(path.join(source, 'kimi.plugin.json'));
  const codex = await json(path.join(source, '.codex-plugin/plugin.json'));
  const service = await json(path.join(source, 'service.json'));
  assert(/^v\d+\.\d+\.\d+$/.test(tag) && [kimi.version, codex.version, service.version].every((v) => v === tag.slice(1)),
    'tag/Kimi/Codex/service version mismatch');
  for (const host of ['kimi', 'codex']) for (const file of filesFor(host))
    assert((await fs.stat(path.join(source, file))).isFile(), `source missing ${file}`);
  await fs.mkdir(dest, { recursive: true });
  for (const host of ['kimi', 'codex']) {
    const target = path.join(dest, host);
    await fs.mkdir(target); // refuse to overwrite an existing staging tree
    for (const file of filesFor(host)) {
      await fs.mkdir(path.dirname(path.join(target, file)), { recursive: true });
      await fs.copyFile(path.join(source, file), path.join(target, file));
    }
    await verifyPackage(target, host, tag);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, tag, target, source = sourceDefault] = process.argv.slice(2);
  try {
    if (action === 'stage') await stageRelease(source, target, tag);
    else if (action === 'verify') {
      for (const host of ['kimi', 'codex'])
        console.log(JSON.stringify(await verifyPackage(path.join(target, host), host, tag)));
    } else throw new Error('usage: node scripts/release.mjs stage|verify <vX.Y.Z> <directory> [viewer-source]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
