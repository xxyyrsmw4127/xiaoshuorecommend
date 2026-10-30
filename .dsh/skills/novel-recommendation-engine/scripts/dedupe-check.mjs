#!/usr/bin/env node
/**
 * dedupe-check.mjs — 推荐前去重：检查候选书名是否已在阅读历史库中。
 *
 * 用法：
 *   node dedupe-check.mjs "书名1" "书名2" ...
 *   node dedupe-check.mjs --file candidates.txt     # 每行一个书名
 *   node dedupe-check.mjs --author                 # 额外按作者比对
 *
 * 历史库路径默认 ../novel-data/reading-history.jsonl（相对工作区根为 novel-data/reading-history.jsonl），
 * 可用 --history <path> 覆盖。
 *
 * 输出：每行一个候选，标注 OK / DUP(已读) / ALIAS(别名命中) / AUTHOR(同作者已读)。
 * 退出码：有重复则 1，全部干净则 0，便于在流程里直接判断。
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** 规范化书名：去书名号/空白/标点、去常见后缀、全角转半角、简繁常见字归一。 */
export function normalizeTitle(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  // 顺序很重要：必须先去掉"（完结）"" 全本"这类后缀词，再去掉剩余的成对括号，
  // 否则先把全角 （ 当成首部标点剥掉，剩下的 "完结）" 就再也配对不上了。
  const suffix = '(?:完结|全本|全集|校对|精校|番外|未删减|免费|全文|txt|精校版)';
  s = s.replace(new RegExp(`[（(\\[【]?\\s*${suffix}\\s*(?:版)?[）)\\]】]?`, 'gi'), '');
  s = s.replace(new RegExp(`\\s+${suffix}$`, 'gi'), '');
  s = s.replace(/^[《【\[（(『「"'\s]+/, '').replace(/[》】\]）)』」"'\s]+$/, '');
  s = s.replace(/[\s\u3000]+/g, '');
  s = s.replace(/[·・:：,，.。!！?？'"“”‘’\-_—~～|/\\]+/g, '');
  // 全角字母数字 → 半角
  s = s.replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  return s.toLowerCase();
}

const SIMPLIFY = {
  龍: '龙', 劍: '剑', 緣: '缘', 戰: '战', 靈: '灵', 夢: '梦', 國: '国', 學: '学',
  師: '师', 無: '无', 雙: '双', 緣: '缘', 魔: '魔', 醫: '医', 農: '农', 門: '门',
  風: '风', 雲: '云', 電: '电', 陸: '陆', 銀: '银', 鐵: '铁', 樹: '树', 愛: '爱',
};
const toSimplified = (s) => s.replace(/[\u4e00-\u9fff]/g, (c) => SIMPLIFY[c] || c);

export function canon(raw) {
  return toSimplified(normalizeTitle(raw));
}

/**
 * 定位历史库。不能只依赖 cwd：脚本常被从 scripts/ 目录调用，
 * 相对 cwd 解析会指向一个不存在的文件并静默"全部通过"，那就等于去重失效。
 * 因此从 cwd 逐级向上找 novel-data/，最后才回退到 cwd 相对路径。
 */
function resolveHistoryPath() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'novel-data', 'reading-history.jsonl');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), 'novel-data', 'reading-history.jsonl');
}

async function loadHistory(historyPath) {
  if (!existsSync(historyPath)) return { entries: [], missing: true };
  const text = await readFile(historyPath, 'utf8');
  const entries = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    // 去掉 UTF-8 BOM：PowerShell 的 Set-Content -Encoding UTF8 会写入 BOM，
    // 不清掉会让第一行 JSON.parse 失败、静默丢掉第一条历史记录。
    const t = line.replace(/^\uFEFF/, '').trim();
    if (!t || t.startsWith('//')) continue;
    try {
      entries.push(JSON.parse(t));
    } catch {
      console.error(`[警告] 第 ${i + 1} 行 JSON 解析失败，已跳过`);
    }
  }
  return { entries, missing: false };
}

async function main() {
  const argv = process.argv.slice(2);
  const candidates = [];
  let historyPath = resolveHistoryPath();
  let checkAuthor = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') {
      const content = await readFile(argv[++i], 'utf8');
      candidates.push(...content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    } else if (a === '--history') historyPath = path.resolve(argv[++i]);
    else if (a === '--author') checkAuthor = true;
    else candidates.push(a);
  }

  if (candidates.length === 0) {
    console.error('用法: node dedupe-check.mjs "书名" ... [--file list.txt] [--history path] [--author]');
    process.exit(2);
  }

  const { entries, missing } = await loadHistory(historyPath);
  if (missing) console.error(`[提示] 历史库不存在（${historyPath}），视为空库：全部候选通过`);

  const byTitle = new Map();
  const authorSet = new Map();
  for (const e of entries) {
    const keys = [e.title, ...(Array.isArray(e.aliases) ? e.aliases : [])].filter(Boolean).map(canon);
    for (const k of keys) {
      const status = e.status || 'unknown';
      if (!byTitle.has(k)) byTitle.set(k, []);
      byTitle.get(k).push({ title: e.title, status, rating: e.rating });
    }
    if (e.author) {
      const ak = canon(e.author);
      if (!authorSet.has(ak)) authorSet.set(ak, []);
      authorSet.get(ak).push({ title: e.title, status: e.status });
    }
  }

  let dups = 0;
  let authorHits_total = 0;
  for (const cand of candidates) {
    const [titlePart, authorPart] = cand.split(/\s*[|｜]\s*/);
    const key = canon(titlePart);
    const hits = byTitle.get(key);
    const authorKey = authorPart ? canon(authorPart) : null;
    const authorHits = checkAuthor && authorKey ? authorSet.get(authorKey) : null;

    if (hits && hits.length) {
      dups++;
      const detail = hits.map((h) => `${h.title}[${h.status}${h.rating ? `/${h.rating}星` : ''}]`).join(', ');
      console.log(`DUP\t${titlePart}\t已存在: ${detail}`);
    } else if (authorHits && authorHits.length) {
      authorHits_total++;
      console.log(`AUTHOR\t${titlePart}\t同作者已读: ${authorHits.map((h) => h.title).join(', ')}`);
    } else {
      console.log(`OK\t${titlePart}\t可推荐`);
    }
  }

  console.error(
    `\n[汇总] 候选 ${candidates.length} 本，重复 ${dups} 本，同作者命中 ${authorHits_total} 本，历史库 ${entries.length} 条`,
  );
  process.exit(dups > 0 ? 1 : 0);
}

// 仅在作为脚本直接运行时执行，便于被其它脚本 import 复用 normalizeTitle
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('dedupe-check.mjs')) {
  main().catch((err) => {
    console.error(`[致命错误] ${err.message}`);
    process.exit(1);
  });
}
