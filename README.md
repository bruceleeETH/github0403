# 微信公众号文章保存与作者跟踪工具

将微信公众号文章保存到本地，并生成适合 agent 分析的 Markdown、JSON 分析结果和离线 HTML，方便按作者持续跟踪观点变化。

当前优先维护 Web 入口和 Puppeteer 抓取链路：

- 本地网页应用：在浏览器里输入文章链接，查看文章、作者、模型分析和股票追踪
- Puppeteer CLI：保留为命令行抓取入口，和 Web 使用同一套核心模块

Python 轻量文章保存方案已移除；Python 仍用于 Web 内的股票目录和行情更新脚本。Tauri 桌面端开发暂时搁置，当前全力维护 Web 版本。

## 安装

```bash
npm install
```

如需使用股票目录和行情更新，额外安装 Python 依赖：

```bash
pip install -r requirements.txt
```

## 本地网页应用

如需启用 DeepSeek LLM 分析，复制 `.env.example` 为 `.env.local`，填入：

```bash
DEEPSEEK_API_KEY=sk-xxxxx
```

`.env.local` 已被 git 忽略。未配置 key 或 API 调用失败时，应用会标记为“未完成模型分析”，不再展示旧版规则分析。
启用后，文章正文会发送到 DeepSeek API；默认 DeepSeek 分析模型为 `deepseek-v4-flash`，可用 `DEEPSEEK_MODEL` 覆盖。

```bash
npm start
```

启动后打开：

```bash
http://127.0.0.1:4318
```

如果 4318 已被占用，服务会自动尝试后续端口；以终端输出的地址为准。

当前网页应用支持：

- 输入公众号文章 URL 并抓取到本地
- 自动生成离线 HTML、Markdown、analysis.json
- 自动生成 `capture_diagnostics.json`，记录页面加载、正文提取、图片保存和截图状态
- 在每篇文章下保存独立的 `personal_note.md`，用于记录自己的感悟和理解
- 配置 DeepSeek API key 后，用当前配置模型提炼核心观点、板块、个股和市场情绪
- 旧文章未完成模型分析时，可在详情页点击“立刻分析”，直接用本地正文补生成模型分析
- 展示文章列表和作者列表
- 按作者汇总文章数量、关键词和情绪分布
- 维护本地股票池，支持股票增删改查、真实行情更新、日 / 五日 / 周表现排序和关联文章查看
- 抓取、批量抓取、股票目录更新和行情更新会串行执行，避免重复点击造成进程和文件写入冲突

## 使用方法

### Puppeteer CLI

```bash
# 安装 Node 依赖
npm install

# 运行 Puppeteer 方案
npm run wechat:puppeteer -- "https://mp.weixin.qq.com/s/xxxxx"

# 自定义输出目录
npm run wechat:puppeteer -- "https://mp.weixin.qq.com/s/xxxxx" --output ./wechat_articles_puppeteer
```

Puppeteer 方案输出内容包括：

- `meta.json`：标题、公众号、发布时间、来源链接等元数据
- `article.md`：适合 agent 分析的 Markdown，包含 YAML frontmatter
- `personal_note.md`：手写个人感悟、理解、可验证假设和复盘记录
- `analysis.json`：分析结果，包含摘要、关键词、情绪、核心观点；启用 DeepSeek 后会额外包含板块、个股、市场情绪、风险和重要度
- `article_content.html`：正文 HTML
- `offline_article.html`：本地可直接打开的离线页面
- `raw_page.html`：完整页面 HTML
- `preview.png`：整页截图
- `comment_requests.json`：评论相关网络请求观测日志（用于后续排查评论抓取）
- `articles.jsonl`：全局索引，便于按作者和时间做轻量检索

## 输出结构

```
wechat_articles_puppeteer/
├── articles.jsonl
└── 公众号名称/
    └── YYYY-MM-DD_文章标题/
        ├── meta.json
        ├── article.md
        ├── personal_note.md
        ├── analysis.json
        ├── article_content.html
        ├── offline_article.html
        ├── raw_page.html
        ├── preview.png
        ├── comment_requests.json
        ├── capture_diagnostics.json
        └── images/
            ├── img_000.webp
            ├── img_001.webp
            └── ...
```

股票追踪数据默认保存在本地 `stock_tracking/` 目录，该目录会被 git 忽略：

```
stock_tracking/
├── stocks.jsonl
└── daily_prices.jsonl
```

行情更新只拉取关注池股票，A 股优先使用 AkShare，失败时会尝试腾讯备用源。

## 获取文章链接的方法

1. **手机微信** → 打开文章 → 右上角 `...` → 复制链接
2. **电脑微信** → 打开文章 → 复制地址栏 URL
3. **搜狗微信搜索** → https://weixin.sogou.com → 搜索后获取链接

## 注意事项

- 仅支持 `mp.weixin.qq.com` 域名的公众号文章
- 部分文章可能设置了访问限制，需要登录才能查看
- 批量抓取会串行执行，避免请求过于频繁
- 图片会自动下载到本地并替换文档中的远程链接
- 未配置模型时会保留待分析状态，不再使用旧版规则分析结果冒充模型结论
