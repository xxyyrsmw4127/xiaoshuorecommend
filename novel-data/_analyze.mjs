// 分析：用户弃书原因的真实分布（否定空间分析）
import { readFileSync } from 'node:fs';

const recs = readFileSync('novel-data/reading-history.jsonl', 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const dropped = recs.filter((r) => r.status === 'dropped');
const finished = recs.filter((r) => r.status === 'finished');

console.log('=== 总量 ===');
console.log(`finished ${finished.length} | dropped ${dropped.length} | plan ${recs.filter((r) => r.status === 'plan').length} | reading ${recs.filter((r) => r.status === 'reading').length}`);
console.log(`弃书率: ${((dropped.length / (dropped.length + finished.length)) * 100).toFixed(0)}%`);

console.log('');
console.log('=== 弃书原因 code 分布 ===');
const counts = {};
for (const r of dropped) {
  const c = r.drop_reason?.code ?? 'none';
  counts[c] = (counts[c] ?? 0) + 1;
}
Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${String(v).padStart(2)}  ${k}`));

console.log('');
console.log('=== 弃书明细（按 code 分组）===');
const byCode = {};
for (const r of dropped) {
  const c = r.drop_reason?.code ?? 'none';
  (byCode[c] ??= []).push(r.title);
}
for (const [c, titles] of Object.entries(byCode)) {
  console.log(`  [${c}] ${titles.join('、')}`);
}

console.log('');
console.log('=== 完成明细 ===');
finished.forEach((r) => console.log(`  ${r.title} ${r.rating ? r.rating + '星' : ''} (${r.author})`));
