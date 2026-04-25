#!/usr/bin/env node
/**
 * 中文 Changelog 生成器（基于 LLM）
 *
 * 解析 git log，将提交内容发送给 LLM，生成高质量、易读的中文 Changelog。
 * 支持任何 OpenAI 兼容接口，可通过环境变量配置（包括本项目自身的 gateway）。
 *
 * 环境变量：
 *   LLM_API_URL   — API 基础 URL（默认 https://api.openai.com/v1）
 *   LLM_API_KEY   — API 密钥（默认 OPENAI_API_KEY 环境变量）
 *   LLM_MODEL     — 模型名称（默认 gpt-4o-mini）
 *
 * 用法：
 *   node scripts/generate-changelog-zh.mjs --version v0.2.0 --from v0.1.0
 *   node scripts/generate-changelog-zh.mjs --version v0.1.0          # 全部历史
 *   node scripts/generate-changelog-zh.mjs --version v0.1.0 --stdout # 预览到 stdout
 *   node scripts/generate-changelog-zh.mjs --version v0.1.0 --no-llm # 跳过 LLM，用机械生成
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
  const args = { useLlm: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from')        args.from = argv[++i];
    else if (argv[i] === '--to')     args.to = argv[++i];
    else if (argv[i] === '--version') args.version = argv[++i];
    else if (argv[i] === '--stdout') args.stdout = true;
    else if (argv[i] === '--no-llm') args.useLlm = false;
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
  if (type === 'chore' && scope === 'release') return null;
  const isBreaking = !!breaking || /^BREAKING CHANGE/m.test(commit.body);
  return { ...commit, type, scope, desc, isBreaking };
}

// ── LLM 生成 ────────────────────────────────────────────────────────────────

async function generateWithLlm(version, date, parsedCommits) {
  const apiUrl = (process.env.LLM_API_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  const model  = process.env.LLM_MODEL ?? 'gpt-4o-mini';

  if (!apiKey) {
    console.warn('[changelog-zh] 未设置 LLM_API_KEY，回退到机械生成模式。');
    return null;
  }

  const commitLines = parsedCommits.map((c) => {
    const scope = c.scope ? `(${c.scope})` : '';
    const breaking = c.isBreaking ? ' [BREAKING]' : '';
    return `${c.type}${scope}${breaking}: ${c.desc}${c.body ? '\n  > ' + c.body.split('\n').join('\n  > ') : ''}`;
  }).join('\n');

  const prompt = `你是一位技术写作专家，负责为一个开源项目编写高质量的中文 Changelog。

项目介绍：这是一个 Next.js 实现的 OpenAI 兼容 API 代理网关（LLM Gateway），面向企业/团队，
提供用户管理、分组权限、配额控制、使用量统计等功能，管理员通过 Web 后台管理，普通用户通过仪表盘查看使用情况。

请根据以下 git 提交记录，为版本 ${version}（发布日期：${date}）编写一份**高质量、易读**的中文 Changelog。

要求：
- 将相关提交合并、归纳，用自然语言描述功能变更，而不是逐条列出提交信息
- 按功能领域（而非提交类型）组织内容，使用清晰的小标题
- 用中文技术写作风格，简洁而信息密度高
- 输出纯 Markdown，不要加代码块包裹
- 使用 emoji 图标让标题更醒目（✨ 新增 / 🐛 修复 / ⚡ 改进 / 📝 文档 / 🔧 工程）
- 只输出版本内容部分（从 ### 小标题开始），不要输出 ## [版本] 标题行
- 不要包含任何前言或解释性文字，直接输出 Markdown 内容

提交记录：
${commitLines}`;

  process.stderr.write('[changelog-zh] 正在调用 LLM 生成中文 Changelog...\n');

  const res = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[changelog-zh] LLM 调用失败 (HTTP ${res.status})，回退到机械生成模式。\n${text}`);
    return null;
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

// ── 机械生成（兜底） ─────────────────────────────────────────────────────────

function formatEntry(parsed) {
  const scope = parsed.scope ? `**${parsed.scope}**: ` : '';
  const hash = parsed.hash.slice(0, 7);
  return `- ${scope}${parsed.desc} (\`${hash}\`)`;
}

function buildFallbackSection(parsedCommits) {
  const breaking = parsedCommits.filter((c) => c.isBreaking);
  const byType = {};
  for (const c of parsedCommits) {
    if (!byType[c.type]) byType[c.type] = [];
    byType[c.type].push(c);
  }

  const lines = [];

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

// ── 文件写入 ────────────────────────────────────────────────────────────────

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

const parsedCommits = commits.map(parseCommit).filter(Boolean);

let bodyContent;
if (args.useLlm) {
  bodyContent = await generateWithLlm(version, date, parsedCommits);
}
if (!bodyContent) {
  bodyContent = buildFallbackSection(parsedCommits);
}

const section = `## [${version}] - ${date}\n\n${bodyContent}`;

if (args.stdout) {
  console.log(section);
} else {
  prependToFile(OUTPUT, section);
  console.log(`[changelog-zh] 已更新 CHANGELOG-zh.md（${commits.length} 条提交）`);
}
