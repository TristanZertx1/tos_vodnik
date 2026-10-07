const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.cwd();
const sourceDir = path.join(root, 'site-source');
const publicDir = path.join(root, 'public');
const outputDir = path.join(root, 'dist');
const pages = ['/', '/o-tos', '/novosti', '/meropriyatiya', '/proekty', '/dokumenty', '/kontakty'];

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.cpSync(sourceDir, outputDir, { recursive: true });
fs.cpSync(publicDir, outputDir, { recursive: true });

const app = fs.readFileSync(path.join(sourceDir, 'app.js'), 'utf8');
const start = app.indexOf('function render(d)');
const end = app.indexOf('function applyBuilderText');
if (start < 0 || end < 0) throw new Error('Не найден рендерер страниц в site-source/app.js');
const helpersStart = app.indexOf('function applyBuilderFooter');
if (helpersStart < 0) throw new Error('Не найдены вспомогательные функции рендерера');
const fetchStart = app.indexOf("\nfetch('", helpersStart);
const helpersEnd = fetchStart > 0 && fetchStart < start ? fetchStart : start;
const renderer = app.slice(helpersStart, helpersEnd) + app.slice(start, end);
const data = JSON.parse(fs.readFileSync(path.join(sourceDir, 'content.json'), 'utf8'));

function renderPage(route) {
  const main = { innerHTML: '' };
  const newsList = { set innerHTML(value) { main.innerHTML = main.innerHTML.replace('<div id="news-list"></div>', `<div id="news-list">${value}</div>`); } };
  const document = {
    title: 'ТОС «Водники» — вместе делаем микрорайон лучше',
    documentElement: { dataset: {} },
    querySelector(selector) { return selector === 'main' ? main : selector === '#news-list' ? newsList : null; },
    querySelectorAll() { return []; },
  };
  const context = { document, location: { pathname: route, origin: 'https://tos-vodnik.onrender.com' }, URL, Intl, Date, Math, JSON, console };
  vm.runInNewContext(`${renderer}\nrender(data);`, { ...context, data }, { timeout: 5000 });
  return { html: main.innerHTML, title: document.title };
}

const template = fs.readFileSync(path.join(sourceDir, 'index.html'), 'utf8');
for (const route of pages) {
  const result = renderPage(route);
  if (!result.html || !result.html.trim()) throw new Error(`Для ${route} получилась пустая страница.`);
  const title = result.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<main id="main">[\s\S]*?<\/main>/, `<main id="main">${result.html}</main>`)
    .replace(/<script src="\/app\.js\?v=[^"]*"><\/script>/, '<script src="/app.js?v=3"></script>');
  const dir = route === '/' ? outputDir : path.join(outputDir, route.slice(1));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  console.log(`${route}: ${result.title}`);
}

const adminDir = path.join(outputDir, 'admin');
fs.mkdirSync(adminDir, { recursive: true });
fs.copyFileSync(path.join(sourceDir, 'admin.html'), path.join(adminDir, 'index.html'));


