可以，100 只自选股这个规模非常适合做成一个轻量、稳定、低维护的数据采集系统。

我直接给你一个面向落地的方案：目标是每天更新这 100 只股票的：

- 日涨幅
- 收盘价格
- 板块信息
- 股票简介

并存入数据库，后续方便做：
- 个股详情页
- 自选池看板
- 板块归因分析
- 涨跌统计
- 历史回看

---

一、先明确需求特点

你这个需求有几个关键点：

1. 股票数量少
只有 100 只，不是全市场。

这意味着你没必要一开始就做全市场抓取，可以直接围绕自选池设计，系统会简单很多。

2. 数据频率低
你要的是：

- 日涨幅
- 收盘价

这本质上是日频数据，通常每天更新一次即可。

3. 基本信息低频变化
- 股票简介
- 板块信息

这两类数据变化不频繁，不需要每天全量重抓。

---

二、推荐总体架构

我建议你用：

- 采集层：Python + AkShare
- 存储层：PostgreSQL 或 SQLite
- 调度层：cron
- 后续展示层：可以再接 Next.js / Supabase

---

三、数据库选型建议

方案 1：先用 SQLite
适合：
- 单机使用
- 开发验证
- 采集脚本先跑通

优点：
- 最省事
- 不需要部署数据库
- Python 直接用

缺点：
- 后续做线上系统扩展一般
- 并发能力弱

---

方案 2：直接用 PostgreSQL
适合：
- 你后面大概率会上 Web
- 想一步到位
- 后面接 Supabase 很顺

优点：
- 结构化强
- 后续做 API / 前端方便
- 可扩展性好

如果你是长期做个人股票系统，我建议直接 PostgreSQL。

---

四、推荐数据表设计

你当前需求其实不复杂，建议拆成 4 张核心表。

---

1) 自选股票表 watchlist_stocks

存你关注的 100 只股票。

字段建议：

id
symbol              -- 股票代码，如 600519
name                -- 股票名称
market              -- sh / sz / bj
is_active           -- 是否继续跟踪
note                -- 备注
created_at
updated_at
说明：
- 这张表是你的“股票池主表”
- 不建议每次脚本都从文件读取股票列表，最好存在数据库里

---

2) 股票日行情表 stock_daily_quotes

存每日收盘价、涨跌幅这些高频数据。

字段建议：

id
symbol
trade_date
close_price
pct_change          -- 日涨幅，单位 %
change_amount       -- 涨跌额，可选
open_price          -- 可选
high_price          -- 可选
low_price           -- 可选
volume              -- 可选
amount              -- 可选
data_source         -- akshare
created_at
updated_at
唯一约束建议：

unique(symbol, trade_date)
说明：
- 你的核心指标“日涨幅、收盘价格”就在这里
- 即使目前不需要，也建议顺手保留 open/high/low/volume，后面很容易用上

---

3) 股票基础信息表 stock_profiles

存股票简介、主营业务等低频信息。

字段建议：

id
symbol
name
industry
region
listing_date
main_business
company_profile
data_source
updated_at
说明：
- 这是低频更新表
- 一只股票通常只保留最新一份即可
- 如果你后面想保留历史版本，可以再做快照表，但现在没必要

---

4) 股票板块关联表 stock_boards

存某只股票属于哪些板块。

字段建议：

id
symbol
board_name
board_type          -- industry / concept / region
data_source
updated_at
唯一约束建议：

unique(symbol, board_name, board_type)
说明：
- 一只股票可能属于多个概念板块
- 不要把板块字段直接塞进 stock_profiles
- 一定要做成多对多关系

---

五、为什么不建议只做一张大表

有些人会想做成这样：

symbol | name | trade_date | close_price | pct_change | company_profile | board_name
这个结构问题很大：

1. 冗余严重
- 股票简介每天重复一遍
- 板块信息每天重复一遍

2. 更新麻烦
- 简介更新要改很多行
- 板块变更不好维护

3. 后续扩展差
- 查询板块成分股很难做
- 做多板块关联很别扭

所以建议坚持分表。

---

六、推荐更新策略

你这个场景最适合 “高频行情 + 低频资料” 分开更新。

---

A. 每日任务：更新行情
每天收盘后跑一次：

更新内容：
- 收盘价
- 日涨幅
- 涨跌额
- 可选：开高低成交量

写入：
- stock_daily_quotes

频率建议：
- 每个交易日 15:30 之后
- 或晚上 18:00 执行更稳

---

B. 每周任务：更新板块信息
更新内容：
- 行业板块
- 概念板块
- 地域板块（如果你关心）

写入：
- 先删除该股票旧板块
- 再插入最新板块列表

频率建议：
- 每周 1 次够了
- 比如周六上午

---

C. 每月任务：更新股票简介
更新内容：
- 主营业务
- 公司简介
- 行业/地域等基础字段

写入：
- stock_profiles

频率建议：
- 每月 1 次足够
- 或你手动触发更新

---

七、采集流程设计

建议分成 3 个独立脚本，不要写成一个大脚本。

---

1. sync_daily_quotes.py
功能：
- 从 watchlist_stocks 取 100 只股票
- 拉取最新日线/最新交易日行情
- 写入 stock_daily_quotes

逻辑：
1. 查出启用的自选股票
2. 对每只股票请求 AkShare
3. 获取最近一个交易日数据
4. upsert 到数据库

---

2. sync_stock_profiles.py
功能：
- 更新股票简介、主营业务等

逻辑：
1. 查出自选股列表
2. 拉取公司资料
3. 更新 stock_profiles

---

3. sync_stock_boards.py
功能：
- 更新股票所属板块

逻辑：
1. 查出自选股列表
2. 拉取行业/概念/地域
3. 先删旧数据
4. 再批量插入最新板块

---

八、建议的目录结构

可以这样组织：

stock-tracker/
├─ app/
│  ├─ config.py
│  ├─ db.py
│  ├─ models.py
│  ├─ akshare_client.py
│  ├─ repositories/
│  │  ├─ watchlist_repo.py
│  │  ├─ quote_repo.py
│  │  ├─ profile_repo.py
│  │  └─ board_repo.py
│  └─ services/
│     ├─ quote_service.py
│     ├─ profile_service.py
│     └─ board_service.py
├─ scripts/
│  ├─ init_watchlist.py
│  ├─ sync_daily_quotes.py
│  ├─ sync_stock_profiles.py
│  └─ sync_stock_boards.py
├─ sql/
│  └─ schema.sql
├─ requirements.txt
└─ README.md
---

九、关键实现建议

1) 使用 Upsert
日行情一定要支持重复执行不出错。

例如：
- 已存在 (symbol, trade_date) 就 update
- 不存在就 insert

这样即使你一天跑两次也没问题。

---

2) 对板块信息采用“覆盖式刷新”
因为板块归属可能变化，最简单稳妥的方式是：
 (1/2)
 - 删除该股票当前所有板块记录
- 重新插入最新结果

这比逐条 diff 更省事。

---

3) 股票简介采用“整行覆盖更新”
简介和主营业务一般变化不频繁，直接按 symbol 更新一整行就行。

---

4) 做失败重试和日志
AkShare 或上游源偶尔会抖。

至少要有：
- 请求失败日志
- 单只股票失败不影响全任务
- 最终输出成功/失败数量

---

十、字段口径建议

为了后面前端和分析不乱，建议统一口径。

日行情表
- trade_date：日期型
- close_price：数值型
- pct_change：百分比数值，不带 %
  - 例如涨 3.45%，存 3.45
- volume：原始股数或手数，固定一种口径
- amount：原始金额，固定一种口径

---

股票代码格式建议
统一存成纯 6 位代码：

- 600519
- 000001
- 300750

如果需要交易所信息，单独加字段：
- market = sh/sz/bj

不要一会儿存 sh600519，一会儿存 600519，后面很麻烦。

---

十一、最小可用 SQL 结构示意

下面是简化版思路：

create table watchlist_stocks (
  id serial primary key,
  symbol varchar(10) not null unique,
  name varchar(50),
  market varchar(10),
  is_active boolean default true,
  note text,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

create table stock_daily_quotes (
  id serial primary key,
  symbol varchar(10) not null,
  trade_date date not null,
  close_price numeric(12, 3),
  pct_change numeric(8, 3),
  change_amount numeric(12, 3),
  open_price numeric(12, 3),
  high_price numeric(12, 3),
  low_price numeric(12, 3),
  volume numeric(20, 2),
  amount numeric(20, 2),
  data_source varchar(30) default 'akshare',
  created_at timestamp default now(),
  updated_at timestamp default now(),
  unique(symbol, trade_date)
);

create table stock_profiles (
  id serial primary key,
  symbol varchar(10) not null unique,
  name varchar(50),
  industry varchar(100),
  region varchar(100),
  listing_date date,
  main_business text,
  company_profile text,
  data_source varchar(30) default 'akshare',
  updated_at timestamp default now()
);

create table stock_boards (
  id serial primary key,
  symbol varchar(10) not null,
  board_name varchar(100) not null,
  board_type varchar(30) not null,
  data_source varchar(30) default 'akshare',
  updated_at timestamp default now(),
  unique(symbol, board_name, board_type)
);
---

十二、调度建议

每天
18:00 sync_daily_quotes.py
每周六
09:00 sync_stock_boards.py
每月 1 号
10:00 sync_stock_profiles.py
---

十三、后面前端能直接做什么

有了这 4 张表，你很容易做：

1. 自选股总览页
显示：
- 股票代码
- 名称
- 最新收盘价
- 最新日涨幅
- 所属行业/概念数量

2. 个股详情页
显示：
- 公司简介
- 主营业务
- 行业/概念板块
- 最近 N 天收盘价走势

3. 板块归因页
显示：
- 某概念下你的自选股有哪些
- 某行业下最近涨跌表现

---

十四、我对你这个需求的最终建议

最推荐方案
如果你想省事但后续可扩展：

- 数据库：PostgreSQL
- 采集：Python + AkShare
- ORM：SQLAlchemy
- 调度：cron
- 后续 Web：Next.js + Supabase 或直接连 Postgres
