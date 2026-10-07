const fs = require('node:fs');
const source = fs.readFileSync('site-source/app.js', 'utf8');
const loadStart = source.indexOf('\nasync function loadPublicContent()');
const renderStart = source.indexOf('function render(d)');
const renderEnd = source.indexOf("\ndocument.querySelector('.menu').onclick", renderStart);
if (loadStart < 0 || renderStart < 0 || renderEnd < 0) {
  throw new Error('Не удалось найти границы функций рендерера в site-source/app.js');
}
const start = source.slice(0, loadStart);
const renderer = source.slice(renderStart, renderEnd);
const wrapper = `// @ts-nocheck\n// Generated from the retained site renderer; executed on the server only.\nexport function renderPublic(data, pathname) {\nconst output={innerHTML:''};\nconst document={title:'ТОС «Водники» — вместе делаем микрорайон лучше',querySelectorAll:()=>[],querySelector(selector){if(selector==='main')return output;if(selector==='#news-list')return {set innerHTML(value){output.innerHTML=output.innerHTML.replace('<div id="news-list"></div>','<div id="news-list">'+value+'</div>')}};return {}}};\nconst location={pathname,origin:'https://tos-vodniki-perm.uhjitd-ru.chatgpt.site'};\n${start}\n${renderer}\nrender(data);\nreturn {html:output.innerHTML,title:document.title};\n}\n`;
fs.writeFileSync('lib/public-render.ts', wrapper);
