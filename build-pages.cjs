const fs = require('node:fs');
const vm = require('node:vm');
const routes = ['', 'o-tos', 'novosti', 'meropriyatiya', 'proekty', 'dokumenty', 'kontakty'];
const content = JSON.parse(fs.readFileSync('dist/content.json', 'utf8'));
const template = fs.readFileSync('dist/index.html', 'utf8');
for (const route of routes) {
  const main = { innerHTML: '' };
  const context = vm.createContext({
    URL, Intl, Date, location: { pathname: route ? '/' + route + '/' : '/', origin: 'https://tos-vodniki-perm.uhjitd-ru.chatgpt.site' },
    document: {
      title: 'ТОС «Водники» — вместе делаем микрорайон лучше',
      querySelector(selector) {
        if (selector === 'main') return main;
        if (selector === '#news-list') return { set innerHTML(value) { main.innerHTML = main.innerHTML.replace('<div id="news-list"></div>', '<div id="news-list">' + value + '</div>'); } };
        return {};
      },
      querySelectorAll() { return []; },
    },
    fetch() { return { then() { return this; }, catch() { return this; } }; },
    __content: content,
  });
  vm.runInContext(fs.readFileSync('dist/app.js', 'utf8'), context);
  vm.runInContext('render(__content)', context);
  if (!main.innerHTML.includes('<h1>') || main.innerHTML.length < 500) throw new Error('Missing content: ' + route);
  let html = template.replace(/<main id="main">[\s\S]*?<\/main>/, '<main id="main">' + main.innerHTML + '</main>')
    .replace(/<title>[\s\S]*?<\/title>/, '<title>' + context.document.title + '</title>')
    .replace('<script src="/app.js"></script>', '')
    .replace('<button class="menu" aria-expanded="false" aria-controls="nav">Меню ☰</button>', '<label class="menu" for="menu-toggle"><input id="menu-toggle" type="checkbox" aria-controls="nav"> Меню ☰</label>')
    .replaceAll('/style.css?v=2', '/style.css?v=3')
    .replace(/<button class="(active|)" data-category="([^"]+)">([^<]+)<\/button>/g, '<a class="category-link $1" href="/novosti/?category=$2">$3</a>');
  const directory = route ? 'dist/' + route : 'dist';
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(directory + '/index.html', html);
}
console.log('Rendered 7 complete HTML pages.');
