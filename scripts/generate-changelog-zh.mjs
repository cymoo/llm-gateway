#!/usr/bin/env node
/**
 * 中文 Changelog 生成器（机械模式）
 *
 * 解析 git log，按提交类型分组，输出结构化中文 Markdown。
 * 适用于自动化流水线兜底；如需高质量内容，直接向 Copilot/AI 提问即可。
 *
 * 用法：
 *   node scripts/generate-changelog-zh.mjs --version v0.2.0 --from v0.1.0
 *   node scripts/generate-changelog-zh.mjs --version v0.1.0          # 全部历史
 *   node scripts/generate-changelog-zh.mjs --version v0.1.0 --stdout # 预览到 stdout
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = resolve(ROOT, 'CHANGELOG-zh.md');

const TYPE_MAP = {
  feat:     '✨ 新功能',
  fix:      '🐛 问题修复',
  perf:     '⚡ 性能优化',
  refactor: '♻️ 代码重构',
  docs:     '📝 文档更新',
  test:     '✅ 测试',
  build:    '📦 构建',
  ci:       '👷 持续集成',
  chore:    '🔧 杂项',
  style:    '💄 代码风格',
  revert:   '⏪ 回滚',
};

// ── 参数解析 ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from')         args.from = argv[++i];
    else if (argv[i] === '--to')      args.to = argv[++i];
    else if (argv[i] === '--version') args.version = argv[++i];
    else if (argv[i] === '--stdout')  args.stdout = true;
  }
  return args;
}

// ── Git 解析 ─────────────────────────────────────────────────────────────────

function getCommits(from, to = 'HEAD') {
  const range = from ? `${from}..${to}` : to;
  try {
    const raw = execFileSync(
      'git',
      ['log', '--format=%x1e%H%x1f%s%x1f%B', range],
      { cwd: ROOT, encoding: 'utf8' }
    );
    return parseCommitLog(raw);
  } catch {
    return [];
  }
}

function parseCommitLog(raw) {
  return raw
    .split('\x1e')
    .slice(1)
    .map((record) => {
      const idx1 = record.indexOf('\x1f');
      const idx2 = record.indexOf('\x1f', idx1 + 1);
      if (idx1 === -1 || idx2 === -1) return null;
      const hash = record.slice(0, idx1).trim();
      const subject = record.slice(idx1 + 1, idx2).trim();
      const body = record.slice(idx2 + 1).trim();
      return { hash, subject, body };
    })
    .filter((c) => c && c.subject);
}

function parseCommit(commit) {
  const match = commit.subject.match(
    /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?\s*:\s*(?<desc>.+)$/
  );
  if (!match) return null;
  const { type, scope, breaking, desc } = match.groups;
  if (type === 'chore' && scope === 'release') return null;
  const isBreaking = !!breaking || /^BREAKING CHANGE/m.test(commit.body);
  return { ...commit, type, scope, desc, isBreaking };
}

// ── 格式化 ───────────────────────────────────────────────────────────────────

function formatEntry(parsed) {
  const scope = parsed.scope ? `**${parsed.scope}**: ` : '';
  const hash = parsed.hash.slice(0, 7);
  return `- ${scope}${parsed.desc} (\`${hash}\`)`;
}

function buildSection(version, date, commits) {
  const parsed = commits.map(parseCommit).filter(Boolean);

  const breaking = parsed.filter((c) => c.isBreaking);
  const byType = {};
  for (const c of parsed) {
    if (!byType[c.type]) byType[c.type] = [];
    byType[c.type].push(c);
  }

  const lines = [`## [${version}] - ${date}`, ''];

  if (breaking.length) {
    lines.push('### ⚠️ 破坏性变更', '');
    for (const c of breaking) lines.push(formatEntry(c));
    lines.push('');
  }

  for (const [type, label] of Object.entries(TYPE_MAP)) {
    const items = byType[type];
    if (!items?.length) continue;
    lines.push(`### ${label}`, '');
    for (const c of items) lines.push(formatEntry(c));
    lines.push('');
  }

  return lines.join('\n');
}

// ── 文件写入 ─────────────────────────────────────────────────────────────────

function prependToFile(filePath, section) {
  const HEADER =
    '# 更新日志\n\n所有值得关注的更改都将记录在此文件中。\n\n' +
    '格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，' +
    '版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。\n';
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf8');
    if (existing.startsWith('# 更新日志')) {
      const afterHeader = existing.slice(existing.indexOf('\n\n') + 2);
      writeFileSync(filePath, `${HEADER}\n${section}\n${afterHeader}`);
    } else {
      writeFileSync(filePath, `${HEADER}\n${section}\n${existing}`);
    }
  } else {
    writeFileSync(filePath, `${HEADER}\n${section}\n`);
  }
}

// ── 主程序 ───────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const version = args.version ?? 'Unreleased';
const date = new Date().toISOString().slice(0, 10);
const commits = getCommits(args.from, args.to);

if (commits.length === 0) {
  console.log('[changelog-zh] 没有找到新提交，跳过生成。');
  process.exit(0);
}

const section = buildSection(version, date, commits);

if (args.stdout) {
  console.log(section);
} else {
  prependToFile(OUTPUT, section);
  console.log(`[changelog-zh] 已更新 CHANGELOG-zh.md（${commits.length} 条提交）`);
}
