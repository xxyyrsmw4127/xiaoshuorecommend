#!/usr/bin/env node
/**
 * fetch-page.mjs — 抓取网页并转成适合模型阅读的纯文本。
 *
 * 存在的理由：本机沙箱下 curl / Invoke-WebRequest 会因 schannel 拿不到凭证而 TLS 失败，
 * 但 Node 自带 OpenSSL 直连可用。因此所有联网核实都走这个脚本，不要用 curl。
 *
 * 用法：
 *   node fetch-page.mjs <url> [--max-chars 8000] [--raw]
 *   node fetch-page.mjs <url1> <url2> ...          # 多 URL，逐个输出
 *   node fetch-page.mjs --file urls.txt            # 每行一个 URL
 *   node fetch-page.mjs <url> --fields bookName,author,abstract
 *                                                  # 额外抽取页面内嵌 JSON 的字段
 *                                                  # （番茄等 SPA 站点的正文只存在于内嵌数据里）
 *
 * 输出：stdout 打印带来源 URL 头的纯文本；错误打到 stderr，退出码非 0。
 */

const DEFAULT_MAX = 8000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function parseArgs(argv) {
  const urls = [];
  let maxChars = DEFAULT_MAX;
  let raw = false;
  let file = null;
  let fields = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-chars') maxChars = Number(argv[++i]) || DEFAULT_MAX;
    else if (a === '--raw') raw = true;
    else if (a === '--file') file = argv[++i];
    else if (a === '--fields') fields = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--')) throw new Error(`未知参数: ${a}`);
    else urls.push(a);
  }
  return { urls, maxChars, raw, file, fields };
}

/** 通过 Content-Type 里的 charset 或 HTML meta 嗅探编码，失败则回退 UTF-8。 */
function decode(buffer, contentType) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1];
  let label = fromHeader;
  if (!label) {
    // 只嗅探头部字节，避免把整页按错误编码解成大字符串
    const head = Buffer.from(buffer.subarray(0, 4096)).toString('latin1');
    label =
      /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ||
      /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head)?.[1] ||
      'utf-8';
  }
  const normalized = String(label).toLowerCase();
  const alias = { gb2312: 'gbk', gb18030: 'gbk', 'x-gbk': 'gbk', big5: 'big5' };
  const enc = alias[normalized] || normalized;
  try {
    return new TextDecoder(enc, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
}

/**
 * 剔除整块导航/页脚/侧栏容器。
 * 用标签配对计数而不是正则，因为正则的 `<\/div>` 会停在内层第一个闭合标签上，
 * 结果是把导航的兄弟节点全删掉、只留下导航本身（这正是早期版本的实际 bug）。
 */
function dropNoiseBlocks(html) {
  const NOISE_ATTR =
    /(?:class|id)\s*=\s*["'][^"']*(?:nav|navbar|menu|header|footer|sidebar|breadcrumb|copyright|toolbar|topbar|subnav|searchbar|advert|\bads?\b|friendlink|banner)[^"']*["']/i;
  const TAG = /<(div|nav|header|footer|aside|section|ul)\b[^>]*>/gi;
  let out = '';
  let cursor = 0;
  let m;
  while ((m = TAG.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    if (!NOISE_ATTR.test(m[0])) continue;
    // 从该开标签起做深度计数，找到配对的闭标签
    const start = m.index;
    const inner = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi');
    inner.lastIndex = start;
    let depth = 0;
    let end = -1;
    let t;
    while ((t = inner.exec(html)) !== null) {
      if (t[0][1] === '/') {
        depth--;
        if (depth === 0) {
          end = t.index + t[0].length;
          break;
        }
      } else depth++;
    }
    if (end === -1) continue; // 未闭合，保持原样，避免误删
    out += html.slice(cursor, start);
    cursor = end;
    TAG.lastIndex = end;
  }
  return out + html.slice(cursor);
}

/**
 * 从内嵌 JSON（SPA 常见：`<script id="__NEXT_DATA__">`、`window.__INITIAL_STATE__`）
 * 里按字段名抽取字符串值。抓到的是结构化真值，比解析 HTML 可靠。
 */
function extractEmbeddedFields(html, fields) {
  const found = new Map();
  for (const f of fields) {
    const re = new RegExp(`"${f}"\\s*:\\s*"((?:[^"\\\\]|\\\\.){0,4000})"`, 'g');
    for (const m of html.matchAll(re)) {
      const val = m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\n/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\\//g, '/')
        .trim();
      if (!val) continue;
      if (!found.has(f)) found.set(f, new Set());
      if (found.get(f).size < 40) found.get(f).add(val);
    }
  }
  if (found.size === 0) return null;
  const lines = [];
  for (const [k, set] of found) {
    lines.push(`[${k}] ${[...set].join(' | ')}`);
  }
  return lines.join('\n');
}

/** 极简 HTML → 文本。不追求完美还原，只要正文可读、导航噪声尽量少。 */
function htmlToText(html) {
  return dropNoiseBlocks(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

async function fetchOne(url, { maxChars, raw, fields = [] }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = decode(buf, res.headers.get('content-type'));
    const body = raw ? text : htmlToText(text);
    const embedded = fields.length ? extractEmbeddedFields(text, fields) : null;
    const combined = embedded ? `[内嵌数据抽取]\n${embedded}\n\n[正文文本]\n${body}` : body;
    const clipped =
      combined.length > maxChars
        ? `${combined.slice(0, maxChars)}\n...[已截断，原文 ${combined.length} 字符，需要更多请提高 --max-chars]`
        : combined;
    const type = res.headers.get('content-type') || 'unknown';
    return `### 来源: ${url}\n### HTTP: ${res.status} | Content-Type: ${type} | 字节: ${buf.length}\n\n${clipped}\n`;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { urls, maxChars, raw, file, fields } = parseArgs(process.argv.slice(2));
  if (file) {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(file, 'utf8');
    urls.push(
      ...content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#')),
    );
  }
  if (urls.length === 0) {
    console.error('用法: node fetch-page.mjs <url> [--max-chars N] [--raw] [--fields a,b] [--file urls.txt]');
    process.exit(2);
  }

  let failed = 0;
  for (const url of urls) {
    try {
      process.stdout.write(await fetchOne(url, { maxChars, raw, fields }));
    } catch (err) {
      failed++;
      const cause = err.cause?.code ? ` (${err.cause.code})` : '';
      console.error(`[抓取失败] ${url} :: ${err.message}${cause}`);
    }
    process.stdout.write('\n');
  }
  process.exit(failed === urls.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`[致命错误] ${err.message}`);
  process.exit(1);
});
