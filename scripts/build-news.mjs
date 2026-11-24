import { readdir, readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const contentDir = resolve(root, 'content/news');
const template = await readFile(resolve(root, 'templates/news-article.html'), 'utf8');
const siteOrigin = 'https://www.nswrc.jp';

function escapeAttribute(value) {
  return String(value).replace(/[&<>\"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;'
  })[char]);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:|\/|\.{1,2}\/|#)[^\s)]+)\)/g, (_, label, href) => {
      const external = /^https?:\/\//i.test(href);
      return `<a href="${href}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
}

function renderMarkdown(source) {
  let html = '';
  let paragraph = [];
  let list = '';
  let inCode = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html += '<p>' + renderInline(paragraph.join('\n')).replace(/\n/g, '<br>') + '</p>';
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    html += `</${list}>`;
    list = '';
  };

  for (const line of String(source || '').split(/\r?\n/)) {
    if (line.trim().startsWith('```')) {
      if (!inCode) {
        flushParagraph();
        closeList();
        inCode = true;
        codeLines = [];
      } else {
        html += '<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>';
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    let match;
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    if ((match = line.match(/^(#{1,3})\s+(.+)$/))) {
      flushParagraph();
      closeList();
      const level = match[1].length + 1;
      html += `<h${level}>${renderInline(match[2])}</h${level}>`;
      continue;
    }
    if ((match = line.match(/^[-*+]\s+(.+)$/))) {
      flushParagraph();
      if (list !== 'ul') {
        closeList();
        html += '<ul>';
        list = 'ul';
      }
      html += '<li>' + renderInline(match[1]) + '</li>';
      continue;
    }
    if ((match = line.match(/^\d+\.\s+(.+)$/))) {
      flushParagraph();
      if (list !== 'ol') {
        closeList();
        html += '<ol>';
        list = 'ol';
      }
      html += '<li>' + renderInline(match[1]) + '</li>';
      continue;
    }
    if ((match = line.match(/^>\s?(.*)$/))) {
      flushParagraph();
      closeList();
      html += '<blockquote>' + renderInline(match[1]) + '</blockquote>';
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      closeList();
      html += '<hr>';
      continue;
    }
    closeList();
    paragraph.push(line);
  }

  if (inCode) html += '<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>';
  flushParagraph();
  closeList();
  return html;
}

function renderPagination(items, index) {
  const links = [];
  if (items[index + 1]) {
    const previous = items[index + 1];
    links.push(`<a href="${escapeAttribute(previous.slug)}.html">‹ 前の記事　${escapeHtml(previous.title)}</a>`);
  }
  if (items[index - 1]) {
    const next = items[index - 1];
    links.push(`<a href="${escapeAttribute(next.slug)}.html">次の記事　${escapeHtml(next.title)} ›</a>`);
  }
  return links.length ? `<nav class="article-pagination" aria-label="前後のお知らせ">${links.join('')}</nav>` : '';
}

function renderArticle(item, index, items) {
  const title = item.title + ' | 全国学生無線通信研究会';
  const url = `${siteOrigin}/news/${item.slug}.html`;
  const meta = `<div class="article-meta"><time datetime="${escapeAttribute(item.date)}">${escapeHtml(item.date)}</time><span class="notice-category">${escapeHtml(item.category || 'お知らせ')}</span></div>`;
  const back = '<a class="article-back" href="../news.html">← お知らせ一覧へ戻る</a>';
  return template
    .replaceAll('__PAGE_TITLE__', escapeAttribute(title))
    .replaceAll('__OG_TITLE__', escapeAttribute(title))
    .replaceAll('__OG_DESCRIPTION__', escapeAttribute(item.summary))
    .replaceAll('__OG_URL__', escapeAttribute(url))
    .replaceAll('__OG_DATE__', escapeAttribute(item.date))
    .replaceAll('__ARTICLE_META__', meta)
    .replaceAll('__ARTICLE_TITLE__', escapeHtml(item.title))
    .replaceAll('__ARTICLE_SUMMARY__', escapeHtml(item.summary))
    .replaceAll('__ARTICLE_BODY__', renderMarkdown(item.body))
    .replaceAll('__ARTICLE_PAGINATION__', renderPagination(items, index))
    .replaceAll('__ARTICLE_BACK__', back);
}
function parseFrontmatter(source, file) {
  const match = source.replace(/^\uFEFF/, '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`Missing YAML front matter: ${file}`);
  const meta = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const pair = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (!pair) throw new Error(`Invalid front matter in ${file}: ${line}`);
    const [, key] = pair;
    let value = pair[2].trim();
    if (value === '|' || value === '|-' || value === '>' || value === '>-') {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].replace(/^\s{2}/, ''));
      value = value === '>' || value === '>-' ? block.join(' ').trim() : block.join('\n').trim();
    } else if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { throw new Error(`Invalid quoted value for ${key} in ${file}`); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replace(/''/g, "'");
    }
    meta[key] = value;
  }
  const item = { ...meta, body: match[2].trim() };
  for (const key of ['date', 'slug', 'category', 'title', 'summary']) {
    if (!item[key]) throw new Error(`Missing "${key}" in ${file}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || Number.isNaN(Date.parse(item.date))) {
    throw new Error(`Invalid date in ${file}: ${item.date}`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) throw new Error(`Invalid slug in ${file}: ${item.slug}`);
  return item;
}

let files = [];
try { files = (await readdir(contentDir)).filter(name => name.endsWith('.md') && !name.startsWith('_')).sort(); }
catch (error) { if (error.code !== 'ENOENT') throw error; throw new Error('content/news directory is missing. Add Markdown source files before building.'); }
if (!files.length) throw new Error('No Markdown articles found in content/news. Refusing to overwrite published news with an empty list.');

const items = [];
const seen = new Set();
for (const file of files) {
  const item = parseFrontmatter(await readFile(resolve(contentDir, file), 'utf8'), file);
  if (seen.has(item.slug)) throw new Error(`Duplicate slug: ${item.slug}`);
  seen.add(item.slug);
  items.push(item);
}
items.sort((a, b) => b.date.localeCompare(a.date));
const json = JSON.stringify(items, null, 2) + '\n';
for (const target of ['news-data.json', 'docs/news-data.json']) {
  await mkdir(dirname(resolve(root, target)), { recursive: true });
  await writeFile(resolve(root, target), json, 'utf8');
  console.log('Generated ' + target);
}
for (const base of ['news', 'docs/news']) {
  await mkdir(resolve(root, base), { recursive: true });
  const expected = new Set(items.map(item => item.slug + '.html'));
  for (const entry of await readdir(resolve(root, base), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.html') && !expected.has(entry.name)) {
      await unlink(resolve(root, base, entry.name));
      console.log('Removed stale article ' + resolve(root, base, entry.name));
    }
  }
}
for (const item of items) {
  for (const base of ['news', 'docs/news']) {
    const target = resolve(root, base, item.slug + '.html');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, renderArticle(item, items.indexOf(item), items), 'utf8');
    console.log('Generated ' + target);
  }
}
console.log(`Built ${items.length} news article(s) from Markdown.`);
