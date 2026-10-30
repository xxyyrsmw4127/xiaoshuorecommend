# 阅读历史库字段契约

文件：`<工作区>/novel-data/reading-history.jsonl`，每行一个 JSON 对象，UTF-8 **无 BOM**。

> 注意：PowerShell 的 `Set-Content -Encoding UTF8`（Windows PowerShell 5.x）会写入 BOM，
> 虽然脚本已做兼容，但新增记录时建议用 `edit`/`write` 工具或 Node 写入，避免 BOM。

## 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | ✅ | 书名，不带书名号 |
| `author` | string | ✅ | 作者。同名书极多，必须带作者 |
| `status` | enum | ✅ | `finished` / `reading` / `dropped` / `plan` / `paused` |
| `rating` | 1-5 整数 | 仅 finished | 未读完不得打分 |
| `progress` | string | reading/dropped/paused | 如 `"第 120 章"` / `"30%"` |
| `drop_reason` | object | dropped | `{ code, note }`，code 见下表 |
| `tags` | string[] | — | 题材标签，用于反推偏好 |
| `platform` | string | — | 阅读平台 |
| `aliases` | string[] | — | 曾用名/别名，去重时一并比对 |
| `series` | string | — | 系列名，避免把续作当新书推 |
| `added` | string | — | 入库日期 `YYYY-MM-DD` |
| `updated` | string | — | 最近更新日期 `YYYY-MM-DD` |
| `source` | string | — | 记录来源：`user` / `inferred` |

## drop_reason.code 枚举

`pace_slow` 节奏慢 · `pace_rushed` 后期赶 · `protagonist_annoying` 主角劝退 ·
`harem_nonsense` 感情线差 · `power_creep_bad` 战力崩坏 · `plot_logic` 逻辑硬伤 ·
`writing_quality` 文笔 · `translation_mt` 机翻感 · `ai_generated` 疑似 AI 水文 ·
`platform_issue` 平台体验 · `lost_interest` 单纯没兴趣（需追问具体原因）

**同一个 code 累计 ≥ 3 次，应升级为偏好档案里的雷点。**

## 去重键

`title` + `author` 经归一化后比对：去书名号/空白/标点、去「（完结）」「 全本」类后缀、
全角转半角、常见繁体字归一。实现见 `novel-recommendation-engine/scripts/dedupe-check.mjs`。

同一本书**只允许一行**：状态变化改原行，不要追加新行。

## 示例

```json
{"title":"十日终焉","author":"杀虫队队员","status":"finished","rating":5,"tags":["无限流","悬疑","群像"],"platform":"番茄","aliases":["终焉之地"],"added":"2026-02-14","source":"user"}
{"title":"某本弃书","author":"某作者","status":"dropped","progress":"第 22 章","drop_reason":{"code":"pace_slow","note":"前二十章都在铺垫，没有冲突推进"},"added":"2026-02-14","source":"user"}
```
