#!/usr/bin/env python3
"""
微信公众号文章保存工具
将微信公众号文章保存为本地 Markdown 和 HTML 文件。

用法:
    python save_wechat_article.py <文章URL>
    python save_wechat_article.py <文章URL> --format html
    python save_wechat_article.py <文章URL> --format md
    python save_wechat_article.py <文章URL> --format both
    python save_wechat_article.py --batch urls.txt
"""

import argparse
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
import html2text


# 模拟浏览器 User-Agent，避免被拦截
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

OUTPUT_DIR = Path("wechat_articles")


def validate_url(url: str) -> bool:
    """验证是否为微信公众号文章链接"""
    parsed = urlparse(url)
    return parsed.hostname in ("mp.weixin.qq.com",)


def fetch_article(url: str) -> str:
    """获取文章 HTML 内容"""
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return resp.text


def parse_article(html: str, url: str) -> dict:
    """解析文章内容，提取标题、作者、公众号名称、正文等"""
    soup = BeautifulSoup(html, "html.parser")

    # 标题
    title_tag = soup.find("h1", class_="rich_media_title") or soup.find("h1")
    title = title_tag.get_text(strip=True) if title_tag else "未知标题"

    # 公众号名称
    account_tag = soup.find("a", id="js_name") or soup.find(
        "span", class_="rich_media_meta_nickname"
    )
    account = account_tag.get_text(strip=True) if account_tag else ""

    # 作者
    author_tag = soup.find("span", class_="rich_media_meta_text")
    author = author_tag.get_text(strip=True) if author_tag else ""

    # 发布时间 — 从 JS 变量中提取
    publish_time = ""
    time_match = re.search(r"var\s+publish_time\s*=\s*[\"'](.+?)[\"']", html)
    if time_match:
        publish_time = time_match.group(1)
    else:
        # 备选: 从 <em> 标签提取
        em_tag = soup.find("em", id="publish_time")
        if em_tag:
            publish_time = em_tag.get_text(strip=True)

    # 正文 HTML
    content_div = soup.find("div", id="js_content") or soup.find(
        "div", class_="rich_media_content"
    )
    content_html = str(content_div) if content_div else ""

    # 提取正文中的图片 URL
    images = []
    if content_div:
        for img in content_div.find_all("img"):
            src = img.get("data-src") or img.get("src")
            if src and src.startswith("http"):
                images.append(src)

    return {
        "title": title,
        "account": account,
        "author": author,
        "publish_time": publish_time,
        "content_html": content_html,
        "images": images,
        "url": url,
    }


def sanitize_filename(name: str) -> str:
    """清理文件名，移除不合法字符"""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
    name = name.strip(". ")
    return name[:200] if name else "untitled"


def download_images(images: list, save_dir: Path) -> dict:
    """下载图片到本地，返回 URL -> 本地路径映射"""
    img_dir = save_dir / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    url_map = {}
    for i, img_url in enumerate(images):
        try:
            resp = requests.get(img_url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            # 猜测扩展名
            content_type = resp.headers.get("Content-Type", "")
            ext = ".jpg"
            if "png" in content_type:
                ext = ".png"
            elif "gif" in content_type:
                ext = ".gif"
            elif "webp" in content_type:
                ext = ".webp"
            elif "svg" in content_type:
                ext = ".svg"
            filename = f"img_{i:03d}{ext}"
            filepath = img_dir / filename
            filepath.write_bytes(resp.content)
            url_map[img_url] = f"images/{filename}"
            print(f"  已下载图片 {i + 1}/{len(images)}: {filename}")
        except Exception as e:
            print(f"  图片下载失败 {i + 1}/{len(images)}: {e}")
    return url_map


def save_as_html(article: dict, save_dir: Path, img_map: dict) -> Path:
    """保存为完整 HTML 文件"""
    content_html = article["content_html"]
    # 替换图片链接为本地路径
    for remote_url, local_path in img_map.items():
        content_html = content_html.replace(remote_url, local_path)

    html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{article['title']}</title>
    <style>
        body {{
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.8;
            color: #333;
        }}
        .meta {{
            color: #999;
            font-size: 14px;
            margin-bottom: 20px;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
        }}
        img {{
            max-width: 100%;
            height: auto;
        }}
        h1 {{
            font-size: 24px;
            line-height: 1.4;
        }}
    </style>
</head>
<body>
    <h1>{article['title']}</h1>
    <div class="meta">
        <p>公众号: {article['account']} | 作者: {article['author']}</p>
        <p>发布时间: {article['publish_time']}</p>
        <p>原文链接: <a href="{article['url']}">{article['url']}</a></p>
    </div>
    <div class="content">
        {content_html}
    </div>
</body>
</html>"""

    filename = sanitize_filename(article["title"]) + ".html"
    filepath = save_dir / filename
    filepath.write_text(html_content, encoding="utf-8")
    return filepath


def save_as_markdown(article: dict, save_dir: Path, img_map: dict) -> Path:
    """保存为 Markdown 文件"""
    content_html = article["content_html"]
    # 替换图片链接为本地路径
    for remote_url, local_path in img_map.items():
        content_html = content_html.replace(remote_url, local_path)

    # HTML 转 Markdown
    converter = html2text.HTML2Text()
    converter.ignore_links = False
    converter.ignore_images = False
    converter.body_width = 0  # 不自动换行
    converter.protect_links = True
    converter.unicode_snob = True
    md_content = converter.handle(content_html)

    # 组装最终文档
    frontmatter = f"""---
title: "{article['title']}"
account: "{article['account']}"
author: "{article['author']}"
date: "{article['publish_time']}"
source: "{article['url']}"
---

# {article['title']}

> 公众号: {article['account']} | 作者: {article['author']}
> 发布时间: {article['publish_time']}
> [原文链接]({article['url']})

"""
    full_md = frontmatter + md_content

    filename = sanitize_filename(article["title"]) + ".md"
    filepath = save_dir / filename
    filepath.write_text(full_md, encoding="utf-8")
    return filepath


def process_article(url: str, fmt: str = "both", download_img: bool = True):
    """处理单篇文章"""
    if not validate_url(url):
        print(f"⚠ 不是有效的微信公众号文章链接: {url}")
        return

    print(f"正在获取文章: {url}")
    html = fetch_article(url)

    print("正在解析文章内容...")
    article = parse_article(html, url)
    print(f"  标题: {article['title']}")
    print(f"  公众号: {article['account']}")
    print(f"  发布时间: {article['publish_time']}")
    print(f"  图片数量: {len(article['images'])}")

    # 创建保存目录
    safe_title = sanitize_filename(article["title"])
    save_dir = OUTPUT_DIR / safe_title
    save_dir.mkdir(parents=True, exist_ok=True)

    # 下载图片
    img_map = {}
    if download_img and article["images"]:
        print("正在下载图片...")
        img_map = download_images(article["images"], save_dir)

    # 保存文件
    if fmt in ("html", "both"):
        path = save_as_html(article, save_dir, img_map)
        print(f"  已保存 HTML: {path}")
    if fmt in ("md", "both"):
        path = save_as_markdown(article, save_dir, img_map)
        print(f"  已保存 Markdown: {path}")

    print("完成!\n")


def main():
    parser = argparse.ArgumentParser(description="微信公众号文章保存工具")
    parser.add_argument("url", nargs="?", help="文章 URL")
    parser.add_argument(
        "--format",
        choices=["html", "md", "both"],
        default="both",
        help="保存格式 (默认: both)",
    )
    parser.add_argument("--batch", help="批量模式: 包含 URL 列表的文本文件路径 (每行一个)")
    parser.add_argument(
        "--no-images", action="store_true", help="不下载图片"
    )
    parser.add_argument("--output", help="自定义输出目录")

    args = parser.parse_args()

    global OUTPUT_DIR
    if args.output:
        OUTPUT_DIR = Path(args.output)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.batch:
        batch_path = Path(args.batch)
        if not batch_path.exists():
            print(f"文件不存在: {batch_path}")
            sys.exit(1)
        urls = [
            line.strip()
            for line in batch_path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        print(f"批量模式: 共 {len(urls)} 篇文章\n")
        for i, url in enumerate(urls, 1):
            print(f"[{i}/{len(urls)}]")
            process_article(url, args.format, not args.no_images)
            if i < len(urls):
                time.sleep(2)  # 请求间隔防止被限流
    elif args.url:
        process_article(args.url, args.format, not args.no_images)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
