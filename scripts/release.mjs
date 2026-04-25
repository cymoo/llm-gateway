#!/usr/bin/env node
/**
 * 发布脚本：自动推断版本号 → 生成双语 Changelog → git commit + tag
 *
 * 用法：
 *   node scripts/release.mjs                    # 自动推断 bump 类型
 *   node scripts/release.mjs --patch            # 强制 patch 升级
 *   node scripts/release.mjs --minor            # 强制 minor 升级
 *   node scripts/release.mjs --major            # 强制 major 升级
 *   node scripts/release.mjs --dry-run          # 演习模式（不写文件、不提交）
 *   node scripts/release.mjs --changelog-only   # 仅重新生成 changelog，不修改版本
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Bumper } from 'conventional-recommended-bump';

const ROOT = resolve(import.meta.dirname, '..');
const PKG_PATH = resolve(ROOT, 'package.json');

// ── 工具函数 ────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}

function runSafe(cmd) {
  try {
    return { ok: true, output: run(cmd) };
  } catch (e) {
    return { ok: false, output: e.message };
  }
}

function log(msg) {
  console.log(`\x1b[36m[release]\x1b[0m ${msg}`);
}

function error(msg) {
  console.error(`\x1b[31m[release] ✖ ${msg}\x1b[0m`);
  process.exit(1);
}

function success(msg) {
  console.log(`\x1b[32m[release] ✔ ${msg}\x1b[0m`);
}

// ── 参数解析 ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const isDryRun = argv.includes('--dry-run');
const isChangelogOnly = argv.includes('--changelog-only');
const isFirstRelease = argv.includes('--first-release');
const forceBump = argv.includes('--major')
  ? 'major'
  : argv.includes('--minor')
  ? 'minor'
  : argv.includes('--patch')
  ? 'patch'
  : null;

if (isDryRun) log('演习模式（dry-run）：不会修改文件或创建提交/标签');

// ── 预检 ────────────────────────────────────────────────────────────────────

if (!isChangelogOnly && !isDryRun) {
  // `git status --porcelain` outputs nothing on a clean tree
  const status = runSafe('git status --porcelain');
  if (!status.ok || status.output.trim() !== '') {
    error('工作区有未提交的变更，请先 git add / git commit 或 git stash。');
  }
}

// ── 版本计算 ────────────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
const currentVersion = pkg.version;

async function getBumpType() {
  if (forceBump) return forceBump;
  const bumper = new Bumper(ROOT).loadPreset('angular');
  const { releaseType, reason } = await bumper.bump();
  if (!releaseType) {
    error('没有找到可发布的提交（无 feat/fix/breaking 类提交），请使用 --patch/--minor/--major 手动指定版本号。');
  }
  log(`推断 bump 类型：${releaseType}（${reason}）`);
  return releaseType;
}

function bumpVersion(version, bumpType) {
  const [major, minor, patch] = version.split('.').map(Number);
  switch (bumpType) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: return `${major}.${minor}.${patch + 1}`;
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  // 1. 确定新版本号
  let newVersion = currentVersion;
  if (!isChangelogOnly && !isFirstRelease) {
    const bumpType = await getBumpType();
    newVersion = bumpVersion(currentVersion, bumpType);
    log(`版本升级：${currentVersion} → ${newVersion}`);
  } else if (isFirstRelease) {
    log(`首次发布：使用当前版本 ${newVersion}，不升级版本号`);
  }

  const tagName = `v${newVersion}`;

  // 检查 tag 是否已存在
  if (!isChangelogOnly && !isDryRun) {
    const existingTag = runSafe(`git tag -l "${tagName}"`);
    if (existingTag.ok && existingTag.output === tagName) {
      error(`标签 ${tagName} 已存在，请检查版本号。`);
    }
  }

  // 2. 获取上一个 tag（用于 changelog 范围）
  const lastTag = runSafe('git describe --tags --abbrev=0').ok
    ? run('git describe --tags --abbrev=0')
    : null;

  log(lastTag ? `上一个标签：${lastTag}` : '未找到已有标签，将生成完整历史 changelog');

  // 3. 更新 package.json 版本号
  if (!isChangelogOnly && !isFirstRelease) {
    if (isDryRun) {
      log(`[dry-run] 将更新 package.json: version = "${newVersion}"`);
    } else {
      pkg.version = newVersion;
      writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
      success(`package.json 版本已更新为 ${newVersion}`);
    }
  }

  // 4. 生成英文 Changelog（conventional-changelog-cli）
  log('生成英文 CHANGELOG.md...');
  // -r 0：包含所有历史（首次无 tag 时用）；-r 1：仅最新版本
  const releaseCount = lastTag ? '1' : '0';
  const ccCmd = [
    'npx conventional-changelog',
    '-p angular',
    '-i CHANGELOG.md',
    '-s',
    `-r ${releaseCount}`,
  ].join(' ');

  if (isDryRun) {
    log(`[dry-run] 将运行：${ccCmd}`);
    // 预览前 30 行
    const preview = run(`${ccCmd.replace('-s', '')} -o /dev/stdout 2>/dev/null || true`);
    console.log(preview.split('\n').slice(0, 30).join('\n'));
  } else {
    run(ccCmd);
    success('CHANGELOG.md 已更新');
  }

  // 5. 生成中文 Changelog
  log('生成中文 CHANGELOG-zh.md...');
  const zhArgs = [
    'node', 'scripts/generate-changelog-zh.mjs',
    '--version', tagName,
  ];
  if (lastTag) zhArgs.push('--from', lastTag);
  if (isDryRun) zhArgs.push('--stdout', '--no-translate');

  const zhResult = spawnSync(zhArgs[0], zhArgs.slice(1), {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (zhResult.status !== 0) {
    error(`中文 changelog 生成失败：${zhResult.stderr}`);
  }

  if (isDryRun) {
    log('[dry-run] 中文 changelog 预览：');
    console.log(zhResult.stdout.split('\n').slice(0, 30).join('\n'));
  } else {
    if (zhResult.stdout) process.stdout.write(zhResult.stdout);
    success('CHANGELOG-zh.md 已更新');
  }

  if (isChangelogOnly) {
    success('Changelog 已重新生成，未修改版本号。');
    return;
  }

  // 6. git add → commit → tag
  if (!isDryRun) {
    run('git add package.json CHANGELOG.md CHANGELOG-zh.md');
    run(`git commit -m "chore(release): ${tagName}"`);
    run(`git tag -a "${tagName}" -m "${tagName}"`);
    success(`已创建提交和标签 ${tagName}`);
    console.log('');
    console.log('推送到远端：');
    console.log(`  git push && git push --tags`);
  } else {
    log(`[dry-run] 将执行：git add → git commit "chore(release): ${tagName}" → git tag ${tagName}`);
    log('[dry-run] 演习完成，未做任何实际修改。');
  }
}

main().catch((e) => error(e.message));
