#!/usr/bin/env node
/**
 * 中文 Changelog 生成器（含自动翻译）
 *
 * 解析 git log，将提交描述翻译为中文，按类型分组，输出 Markdown。
 * 翻译通过 Google Translate 免费接口完成，无需 API key。
 *
 * 用法：
 *   node scripts/generate-changelog-zh.mjs --version v0.2.0 --from v0.1.0
 *   node scripts/generate-changelog-zh.mjs --version v0.1.0          # 全部历史
 *   node scripts/generate-changelog-zh.mjs --version v0.1.0 --stdout # 预览到 stdout
 *   node scripts/generate-changelog-zh.mjs --version v0.1.0 --no-translate # 跳过翻译
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

// ── 参数解析 ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { translate: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from')         args.from = argv[++i];
    else if (argv[i] === '--to')      args.to = argv[++i];
    else if (argv[i] === '--version') args.version = argv[++i];
    else if (argv[i] === '--stdout')  args.stdout = true;
    else if (argv[i] === '--no-translate') args.translate = false;
  }
  return args;
}

// ── Git 解析 ────────────────────────────────────────────────────────────────

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
  // 过滤自动生成的 release 提交（chore(release): vX.X.X）
  if (type === 'chore' && scope === 'release') return null;
  const isBreaking = !!breaking || /^BREAKING CHANGE/m.test(commit.body);
  return { ...commit, type, scope, desc, isBreaking };
}

// ── 翻译 ────────────────────────────────────────────────────────────────────

/** 调用 Google Translate 非官方接口翻译单条文本（sl=en → tl=zh-CN）*/
async function translateOne(text, retries = 3) {
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // 响应格式：[ [ [translated, original], ... ], ... ]
      return data[0].map((seg) => seg[0]).join('').trim();
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  return text; // 翻译失败时保留原文
}

/** 并发翻译多条文本（concurrency 控制并发数，避免触发限流）*/
async function translateBatch(texts, concurrency = 5) {
  const results = new Array(texts.length).fill('');
  let cursor = 0;
  let done = 0;

  // 进度条
  const showProgress = () => {
    process.stderr.write(`\r[changelog-zh] 翻译进度：${done}/${texts.length} `);
  };
  showProgress();

  async function worker() {
    while (cursor < texts.length) {
      const i = cursor++;
      results[i] = await translateOne(texts[i]);
      done++;
      showProgress();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
  process.stderr.write('\n');
  return results;
}

// ── 格式化 ──────────────────────────────────────────────────────────────────

function formatEntry(parsed) {
  const scope = parsed.scope ? `**${parsed.scope}**: ` : '';
  const hash = parsed.hash.slice(0, 7);
  const desc = parsed.descZh ?? parsed.desc;
  return `- ${scope}${desc} (\`${hash}\`)`;
}

async function buildSection(version, date, commits, doTranslate) {
  const parsed = commits.map(parseCommit).filter(Boolean);

  if (doTranslate && parsed.length > 0) {
    const descs = parsed.map((c) => c.desc);
    const translated = await translateBatch(descs);
    parsed.forEach((c, i) => {
      c.descZh = translated[i];
    });
  }

  const breaking = parsed.filter((c) => c.isBreaking);
  const byType = {};
  for (const c of parsed) {
    if (!byType[c.type]) byType[c.type] = [];
    byType[c.type].push(c);
  }

  const lines = [];
  lines.push(`## [${version}] - ${date}`);
  lines.push('');

  if (breaking.length) {
    lines.push('### ⚠️ 破坏性变更');
    lines.push('');
    for (const c of breaking) lines.push(formatEntry(c));
    lines.push('');
  }

  for (const [type, label] of Object.entries(TYPE_MAP)) {
    const items = byType[type];
    if (!items || items.length === 0) continue;
    lines.push(`### ${label}`);
    lines.push('');
    for (const c of items) lines.push(formatEntry(c));
    lines.push('');
  }

  return lines.join('\n');
}

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

// ── 主程序 ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const version = args.version ?? 'Unreleased';
const date = new Date().toISOString().slice(0, 10);
const commits = getCommits(args.from, args.to);

if (commits.length === 0) {
  console.log('[changelog-zh] 没有找到新提交，跳过生成。');
  process.exit(0);
}

const section = await buildSection(version, date, commits, args.translate);

if (args.stdout) {
  console.log(section);
} else {
  prependToFile(OUTPUT, section);
  console.log(
    `[changelog-zh] 已更新 CHANGELOG-zh.md（${commits.length} 条提交${args.translate ? '，含机器翻译' : ''}）`
  );
}
