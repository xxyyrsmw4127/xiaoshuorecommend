# 网文推荐助手 · 使用说明

## 这是什么

一套给 AI 用的**网文推荐技能包**。装好后，你只要正常说话（"给我推几本"、"我弃了这本书因为太拖"），AI 就会按固定流程维护你的口味档案、记录阅读历史、联网核实候选并给出带缺点的推荐。

## 文件结构

```
D:\dsh_xiaoshuo\
├─ .dsh\skills\                          # 技能本体（AI 自动发现，无需配置）
│  ├─ novel-preference-profile\          # 口味档案维护
│  │  ├─ SKILL.md
│  │  └─ assets\preference-profile.template.yaml
│  ├─ novel-reading-log\                 # 阅读历史维护
│  │  ├─ SKILL.md
│  │  └─ assets\reading-history.schema.md
│  └─ novel-recommendation-engine\       # 推荐主流程
│     ├─ SKILL.md                        # 含"源可达性地图"
│     └─ scripts\
│        ├─ fetch-page.mjs               # 抓网页 → 纯文本（含内嵌 JSON 抽取）
│        └─ dedupe-check.mjs             # 推荐前去重
├─ novel-data\                           # 你的数据（技能运行时读写）
│  ├─ preference-profile.yaml            # 口味档案
│  └─ reading-history.jsonl             # 阅读历史
└─ README.md                             # 本文件
```

技能改动**即时生效**：`.dsh/skills` 下的文件被监视，目录里新增/改名/改 frontmatter 都会刷新 AI 的技能目录，不需要重启。

## 怎么开始用

直接说人话即可，例如：

- **给偏好**："我男频，只看完本，爱看无限流和智斗，讨厌圣母主角，受不了后宫。"
- **给历史**："我读过《十日终焉》5 星，《诡秘之主》5 星，还有一本《XX》看到 20 章弃了，太拖。"
- **要推荐**："按我的口味推几本。"
- **给反馈**："你推的《YY》我看了，前 30 章弃了，主角太蠢。"
- **查记录**："我读过哪些五星的？"

AI 会自动加载对应技能，并在每次反馈后更新 `novel-data/` 里的两个数据文件。

## 两个数据文件的作用

| 文件 | 回答的问题 | 谁来写 |
|---|---|---|
| `preference-profile.yaml` | 你喜欢什么、绝对不看什么（带权重和证据） | 你说口味时 AI 写，写完会向你确认 |
| `reading-history.jsonl` | 你读过什么、为什么弃（**弃书原因最有价值**） | 你给书单/反馈时 AI 写 |

这两个文件是纯文本，你可以直接打开改。**弃书原因比评分更重要**——它是排除未来烂推荐的关键信号。

## 环境注意事项（已实测）

- **禁止用 `curl` / `Invoke-WebRequest` 联网**：本机沙箱下 schannel 拿不到凭证，TLS 必然失败。所有抓取走 `fetch-page.mjs`（Node 自带 OpenSSL，直连正常）。
- **起点全站反爬**（返回 202 空壳），**知乎专栏/百度百科/贴吧 403**。技能里已写明替代路径（web_search 摘要 + 番茄/纵横/晋江具体书页 + Sohu 转载页）。
- **番茄小说**抓取效果最好，`--fields` 能直接取出书名/作者/简介/字数，简介里常自带"不后宫/不爽文"这类雷点自述。

## 脚本速查

```bash
# 抓页面（相对路径以工作区根为基准）
node .dsh/skills/novel-recommendation-engine/scripts/fetch-page.mjs "https://fanqienovel.com/page/<id>" --fields bookName,author,abstract

# 推荐前必跑：检查候选是否已读（有重复时退出码 1）
node .dsh/skills/novel-recommendation-engine/scripts/dedupe-check.mjs "书名|作者" "另一本|作者" --author
```

## 维护建议

- 每次推荐后如果 AI 没主动更新档案，直接提醒它"记一下"。
- 觉得推荐跑偏时，最有效的做法是告诉 AI **具体哪本、为什么不对**，而不是"再准一点"。
- 想让推荐范围扩大（比如开始接受追更），直接改 `preference-profile.yaml` 里的 `reading_mode`。
