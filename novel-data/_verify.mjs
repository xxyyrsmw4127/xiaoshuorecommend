// 校验脚本：检查 reading-history.jsonl 的结构完整性与状态分布。可反复运行。
import { readFileSync } from 'node:fs';

const path = 'novel-data/reading-history.jsonl';
const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim());

const records = [];
const bad = [];
lines.forEach((line, i) => {
  try {
    records.push(JSON.parse(line));
  } catch (err) {
    bad.push(`第 ${i + 1} 行: ${err.message}`);
  }
});

const byStatus = {};
for (const r of records) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

const titles = records.map((r) => r.title);
const dups = [...new Set(titles.filter((t, i) => titles.indexOf(t) !== i))];

// 规则校验：未读完不得打分
const ratingViolations = records.filter((r) => r.rating && r.status !== 'finished');
// 规则校验：dropped 必须有 drop_reason
const missingReason = records.filter((r) => r.status === 'dropped' && !r.drop_reason);

console.log('=== 结构 ===');
console.log(`记录数: ${records.length} | 解析失败: ${bad.length}`);
bad.forEach((b) => console.log('  ✗ ' + b));
console.log(`重复书名: ${dups.length ? dups.join(', ') : '无'}`);
console.log('');
console.log('=== 状态分布 ===');
console.log(JSON.stringify(byStatus, null, 0));
console.log('');
console.log('=== 规则校验 ===');
console.log(`未读完却有评分: ${ratingViolations.length ? ratingViolations.map((r) => r.title).join(', ') : '无'}`);
console.log(`dropped 缺 drop_reason: ${missingReason.length ? missingReason.map((r) => r.title).join(', ') : '无'}`);
console.log('');
console.log('=== 本轮改动核对 ===');
for (const t of ['剑道第一仙', '拔魔', '武极天下', '诡秘国度']) {
  const r = records.find((x) => x.title === t);
  console.log(`  ${t} -> ${r ? r.status : '【缺失】'}${r?.drop_reason ? ' / ' + r.drop_reason.code : ''}`);
}
