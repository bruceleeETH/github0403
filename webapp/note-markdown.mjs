import { escapeHtml } from "./research-utils.mjs";

function renderInlineMarkdown(text) {
  let html = escapeHtml(text || "");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function renderMarkdownList(items, ordered = false) {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`;
}

export function renderPersonalNoteMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listItems = [];
  let orderedListItems = [];
  let quoteLines = [];
  let inCode = false;
  let codeLines = [];
  let inFrontmatter = false;
  let frontmatterLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length) {
      html.push(renderMarkdownList(listItems));
      listItems = [];
    }
    if (orderedListItems.length) {
      html.push(renderMarkdownList(orderedListItems, true));
      orderedListItems = [];
    }
  };
  const flushQuote = () => {
    if (!quoteLines.length) return;
    html.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join("")}</blockquote>`);
    quoteLines = [];
  };
  const flushCode = () => {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };
  const flushBlocks = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (line === "---" && index === 0) {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line === "---") {
        inFrontmatter = false;
        if (frontmatterLines.length) {
          html.push(`
            <details class="personal-note-meta">
              <summary>元数据</summary>
              <pre>${escapeHtml(frontmatterLines.join("\n"))}</pre>
            </details>
          `);
          frontmatterLines = [];
        }
      } else {
        frontmatterLines.push(rawLine);
      }
      continue;
    }

    if (line.startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushBlocks();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line) {
      flushBlocks();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      quoteLines.push(line.replace(/^>\s?/, ""));
      continue;
    }

    const task = /^[-*]\s+\[( |x|X)\]\s+(.+)$/.exec(line);
    if (task) {
      flushParagraph();
      flushQuote();
      const checked = task[1].toLowerCase() === "x";
      listItems.push(`<label class="note-task"><input type="checkbox" disabled${checked ? " checked" : ""}> <span>${renderInlineMarkdown(task[2])}</span></label>`);
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      flushQuote();
      listItems.push(renderInlineMarkdown(bullet[1]));
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      flushParagraph();
      flushQuote();
      orderedListItems.push(renderInlineMarkdown(ordered[1]));
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(rawLine.trim());
  }

  if (inCode) flushCode();
  flushBlocks();

  return html.join("") || `<p class="muted-text">还没有笔记内容。</p>`;
}
