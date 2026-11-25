import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAX_FILE_TEXT_BYTES, normalizeFilePath, readProjectTextFile, resolveProjectFile, resolveSelectedFile } from '../server/file-paths.mjs';

test('相对路径统一分隔符、合并重复分隔符并保留中文与空格', () => {
  assert.equal(normalizeFilePath('docs\\指南//final draft.md'), 'docs/指南/final draft.md');
  assert.equal(normalizeFilePath('src\\\\server///file paths.mjs'), 'src/server/file paths.mjs');
});

test('相对路径拒绝绝对、驱动器、UNC、越界段、目录式与非法字符', () => {
  const invalid = [
    '/etc/passwd', 'C:\\Windows\\system.ini', 'C:relative.txt', '\\\\server\\share\\a.txt',
    './a.txt', 'a/../b.txt', 'a/./b.txt', '..', 'a/', 'a\\', '', '   ',
    'a\0b.txt', 'a\nb.txt', 'a\rb.txt',
  ];
  for (const value of invalid) {
    assert.throws(() => normalizeFilePath(value), { code: 'invalid-path' }, JSON.stringify(value));
  }
});

test('项目包含检查接受项目内普通文件并保留规范相对路径', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-file-paths-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, '项目 root');
  await mkdir(path.join(root, 'docs', '指南'), { recursive: true });
  const target = path.join(root, 'docs', '指南', 'final draft.md');
  await writeFile(target, '内容');

  const resolved = await resolveProjectFile(root, 'docs\\指南//final draft.md');
  assert.equal(resolved.path, 'docs/指南/final draft.md');
  assert.equal(resolved.absolutePath, await realpath(target));

  const selected = await resolveSelectedFile(root, target);
  assert.equal(selected.path, 'docs/指南/final draft.md');
});

test('项目包含检查拒绝缺失文件、目录与项目外选择', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-file-paths-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'root');
  await mkdir(path.join(root, 'docs'), { recursive: true });
  const outside = path.join(dir, 'outside.txt');
  await writeFile(outside, 'outside');

  await assert.rejects(resolveProjectFile(root, 'docs/missing.txt'), { code: 'not-found' });
  await assert.rejects(resolveProjectFile(root, 'docs'), { code: 'not-file' });
  await assert.rejects(resolveSelectedFile(root, outside), { code: 'outside-project' });
  await assert.rejects(resolveProjectFile(root, '../outside.txt'), { code: 'invalid-path' });
});

test('项目内符号链接指向外部文件时拒绝访问', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-file-paths-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'root');
  await mkdir(root);
  const outside = path.join(dir, 'outside.txt');
  await writeFile(outside, 'secret');
  const link = path.join(root, 'escape.txt');
  try {
    await symlink(outside, link, 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`当前环境不允许创建文件符号链接：${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(resolveProjectFile(root, 'escape.txt'), { code: 'outside-project' });
  await assert.rejects(resolveSelectedFile(root, link), { code: 'outside-project' });
});

test('项目内符号链接指向项目内文件时允许访问', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-file-paths-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'root');
  await mkdir(root);
  const target = path.join(root, 'target.txt');
  await writeFile(target, 'ok');
  const link = path.join(root, 'link.txt');
  try {
    await symlink(target, link, 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`当前环境不允许创建文件符号链接：${error.code}`);
      return;
    }
    throw error;
  }

  const resolved = await resolveProjectFile(root, 'link.txt');
  assert.equal(resolved.path, 'link.txt');
  assert.equal(resolved.absolutePath, await realpath(target));
  assert.equal((await resolveSelectedFile(root, link)).path, 'target.txt');
});

test('有界文本读取支持中文与恰好 1 MiB，拒绝超限、非法 UTF-8 和 NUL', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-file-read-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, '中文.txt'), '中文文本\n第二行');
  await writeFile(path.join(dir, 'exact.bin'), Buffer.alloc(MAX_FILE_TEXT_BYTES, 97));
  await writeFile(path.join(dir, 'large.bin'), Buffer.alloc(MAX_FILE_TEXT_BYTES + 1, 97));
  await writeFile(path.join(dir, 'invalid.bin'), Buffer.from([0xc3, 0x28]));
  await writeFile(path.join(dir, 'nul.bin'), Buffer.from([97, 0, 98]));

  const chinese = await readProjectTextFile(dir, '中文.txt');
  assert.equal(chinese.content, '中文文本\n第二行');
  assert.equal(chinese.size, Buffer.byteLength(chinese.content));
  const exact = await readProjectTextFile(dir, 'exact.bin');
  assert.equal(exact.size, MAX_FILE_TEXT_BYTES);
  assert.equal(exact.content.length, MAX_FILE_TEXT_BYTES);
  await assert.rejects(readProjectTextFile(dir, 'large.bin'), { code: 'too-large' });
  await assert.rejects(readProjectTextFile(dir, 'invalid.bin'), { code: 'invalid-utf8' });
  await assert.rejects(readProjectTextFile(dir, 'nul.bin'), { code: 'nul-content' });
});

test('文本读取拒绝缺失、目录与符号链接越界，且不返回正文', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-file-read-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'root');
  await mkdir(path.join(root, 'docs'), { recursive: true });
  const outside = path.join(dir, 'secret.txt');
  await writeFile(outside, 'secret');
  const link = path.join(root, 'escape.txt');
  try {
    await symlink(outside, link, 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`当前环境不允许创建文件符号链接：${error.code}`);
      return;
    }
    throw error;
  }

  for (const [filePath, code] of [['missing.txt', 'not-found'], ['docs', 'not-file'], ['escape.txt', 'outside-project']]) {
    await assert.rejects(readProjectTextFile(root, filePath), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.content, undefined);
      return true;
    });
  }
});
