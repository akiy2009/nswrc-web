import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const contentDir = resolve(root, 'content/news');
const template = await readFile(resolve(root, 'templates/news-article.html'), 'utf8');

function parseFrontmatter(source, file) {
  const match = source.replace(/^\uFEFF/, '').match(/^---\\s*\\r?\\n([\\s\\S]*?)\\r?\\n---\\s*(?:\\r?\\n|$)([\\s\\S]*)$/);
  if (!match) throw new Error(`Missing YAML front matter: ${file}`);
  const meta = {};
  const lines = match[1].split(/\\r?\\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\\s*#/.test(line)) continue;
    const pair = line.match(/^([a-zA-Z][\\w-]*):\\s*(.*)$/);
    if (!pair) throw new Error(`Invalid front matter in ${file}: ${line}`);
    const [, key] = pair;
    let value = pair[2].trim();
    if (value === '|' || value === '|-' || value === '>' || value === '>-') {
      const block = [];
      while (i + 1 < lines.length && (/^\\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].replace(/^\\s{2}/, ''));
      value = value === '>' || value === '>-' ? block.join(' ').trim() : block.join('\\n').trim();
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
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(item.date) || Number.isNaN(Date.parse(item.date))) {
    throw new Error(`Invalid date in ${file}: ${item.date}`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) throw new Error(`Invalid slug in ${file}: ${item.slug}`);
  return item;
}

let files = [];
try { files = (await readdir(contentDir)).filter(name => name.endsWith('.md') && !name.startsWith('_')).sort(); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const items = [];
const seen = new Set();
for (const file of files) {
  const item = parseFrontmatter(await readFile(resolve(contentDir, file), 'utf8'), file);
  if (seen.has(item.slug)) throw new Error(`Duplicate slug: ${item.slug}`);
  seen.add(item.slug);
  items.push(item);
}
items.sort((a, b) => b.date.localeCompare(a.date));
const json = JSON.stringify(items, null, 2) + '\\n';
for (const target of ['news-data.json', 'docs/news-data.json']) {
  await mkdir(dirname(resolve(root, target)), { recursive: true });
  await writeFile(resolve(root, target), json, 'utf8');
  console.log('Generated ' + target);
}
for (const item of items) {
  for (const base of ['news', 'docs/news']) {
    const target = resolve(root, base, item.slug + '.html');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, template, 'utf8');
    console.log('Generated ' + target);
  }
}
console.log(`Built ${items.length} news article(s) from Markdown.`);
