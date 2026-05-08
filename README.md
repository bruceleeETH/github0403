# 微信公众号文章保存与作者跟踪工具

将微信公众号文章保存到本地，并生成适合 agent 分析的 Markdown、JSON 分析结果和离线 HTML，方便按作者持续跟踪观点变化。

当前提供三种入口：

- Python 轻量方案：速度快，适合正文批量保存
- Puppeteer 方案：更接近真实浏览器访问，适合作为主抓取链路
- 本地网页应用：在浏览器里输入文章链接，查看文章、作者和基础分析

## 安装

```bash
pip install -r requirements.txt
npm install
```

如果你只想使用其中一个方案：

- 只用 Python：执行 `pip install -r requirements.txt`
- 只用 Puppeteer：执行 `npm install`

## 本地网页应用

如需启用 DeepSeek LLM 分析，复制 `.env.example` 为 `.env.local`，填入：

```bash
DEEPSEEK_API_KEY=sk-xxxxx
```

`.env.local` 已被 git 忽略。未配置 key 或 API 调用失败时，应用会标记为“未完成模型分析”，不再展示旧版规则分析。
启用后，文章正文会发送到 DeepSeek API；当前 DeepSeek 分析模型为 `deepseek-v4-flash`。

```bash
npm start
```

启动后打开：

```bash
http://127.0.0.1:4318
```

当前网页应用支持：

- 输入公众号文章 URL 并抓取到本地
- 自动生成离线 HTML、Markdown、analysis.json
- 在每篇文章下保存独立的 `personal_note.md`，用于记录自己的感悟和理解
- 配置 DeepSeek API key 后，用 `deepseek-v4-flash` 提炼核心观点、板块、个股和市场情绪
- 旧文章未完成模型分析时，可在详情页点击“立刻分析”，直接用本地正文补生成模型分析
- 展示文章列表和作者列表
- 按作者汇总文章数量、关键词和情绪分布

## 使用方法

### 方案 A: Puppeteer（你当前优先使用）

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

### 方案 B: Python（轻量）

### 保存单篇文章  

```bash
# 同时保存为 HTML 和 Markdown（默认）
python save_wechat_article.py "https://mp.weixin.qq.com/s/xxxxx"

# 只保存为 Markdown
python save_wechat_article.py "https://mp.weixin.qq.com/s/xxxxx" --format md

# 只保存为 HTML
python save_wechat_article.py "https://mp.weixin.qq.com/s/xxxxx" --format html

# 不下载图片
python save_wechat_article.py "https://mp.weixin.qq.com/s/xxxxx" --no-images

# 指定输出目录
python save_wechat_article.py "https://mp.weixin.qq.com/s/xxxxx" --output ~/my_articles
```

### 批量保存

创建一个 `urls.txt` 文件，每行放一个文章链接（`#` 开头的行为注释）：

```
# 我收藏的文章
https://mp.weixin.qq.com/s/article1
https://mp.weixin.qq.com/s/article2
https://mp.weixin.qq.com/s/article3
```

然后运行：

```bash
python save_wechat_article.py --batch urls.txt
```

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
        └── images/
            ├── img_000.webp
            ├── img_001.webp
            └── ...
```

## 获取文章链接的方法

1. **手机微信** → 打开文章 → 右上角 `...` → 复制链接
2. **电脑微信** → 打开文章 → 复制地址栏 URL
3. **搜狗微信搜索** → https://weixin.sogou.com → 搜索后获取链接

## 注意事项

- 仅支持 `mp.weixin.qq.com` 域名的公众号文章
- 部分文章可能设置了访问限制，需要登录才能查看
- 批量下载时自动添加 2 秒间隔，避免请求过于频繁
- 图片会自动下载到本地并替换文档中的远程链接
- 当前基础分析为规则式结果，适合做作者跟踪和整理，不等同于深度研究结论
