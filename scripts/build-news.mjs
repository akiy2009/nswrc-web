import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const dataPath = resolve(root, 'news-data.json');
const templatePath = resolve(root, 'templates/news-article.html');
const items = JSON.parse(await readFile(dataPath, 'utf8'));
if (!Array.isArray(items)) throw new Error('news-data.json must contain an array');
const template = await readFile(templatePath, 'utf8');
const seen = new Set();
for (const item of items) {
  if (!item.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) {
    throw new Error('Invalid or missing slug: ' + (item.title || '(untitled)'));
  }
  if (seen.has(item.slug)) throw new Error('Duplicate news slug: ' + item.slug);
  seen.add(item.slug);
  for (const base of ['news', 'docs/news']) {
    const target = resolve(root, base, item.slug + '.html');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, template, 'utf8');
    console.log('Generated ' + target);
  }
}
