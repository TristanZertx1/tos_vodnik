import { env } from 'cloudflare:workers';
import template from '../../site-source/index.html?raw';
import adminPage from '../../site-source/admin.html?raw';
import { readPublic } from '../../lib/cms';
import { renderPublic } from '../../lib/public-render';
import { ensureResearchMaterials } from '../../lib/researched-content';
export const dynamic = 'force-dynamic';
const escape = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const decodeSegment = (s:string) => { try { return decodeURIComponent(s); } catch { return ''; } };
const homeOrder = ['hero','quick','overview','news','events','projects','join'];
function splitTopLevel(html:string) {
  const blocks:{start:number;end:number;html:string}[]=[]; const stack:string[]=[]; let start=-1;
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const token= /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>/g; let match:RegExpExecArray|null;
  while((match=token.exec(html))){const value=match[0]; if(value.startsWith('<!--')||value.startsWith('<!'))continue;
    const close=value.match(/^<\/([a-zA-Z][\w:-]*)/), open=value.match(/^<([a-zA-Z][\w:-]*)/);
    if(close){const name=close[1].toLowerCase(), idx=stack.lastIndexOf(name); if(idx<0)continue; stack.splice(idx); if(!stack.length&&start>=0){blocks.push({start,end:token.lastIndex,html:html.slice(start,token.lastIndex)});start=-1;}}
    else if(open){if(!stack.length)start=match.index; const name=open[1].toLowerCase(); if(!voidTags.has(name)&&!value.endsWith('/>'))stack.push(name); else if(!stack.length&&start>=0){blocks.push({start,end:token.lastIndex,html:html.slice(start,token.lastIndex)});start=-1;}}
  }
  return blocks;
}
function moduleId(html:string) {
  const cls=html.match(/class="([^"]+)"/)?.[1]||'';
  if(cls.split(/\s+/).includes('hero'))return 'hero'; if(cls.split(/\s+/).includes('quick'))return 'quick';
  if(cls.split(/\s+/).includes('home-overview'))return 'overview'; if(cls.split(/\s+/).includes('tint'))return 'news';
  if(html.includes('class="join"'))return 'join'; if(html.includes('Календарь событий')||html.includes('Ближайшие события')||html.includes('Ближайшие встречи'))return 'events';
  if(html.includes('От идеи к участию')||html.includes('Проекты микрорайона'))return 'projects'; return '';
}
function applyTheme(html:string, layout:any) {
  const theme=layout?.theme||{}, vars:Record<string,string>={};
  const colors:Record<string,string>={primary:'--site-primary',accent:'--site-accent',ink:'--site-ink',muted:'--site-muted',pageBackground:'--site-background',surface:'--site-surface',border:'--site-border',tint:'--site-tint'};
  for(const [key,name] of Object.entries(colors))if(typeof theme[key]==='string'&&/^#[0-9a-f]{6}$/i.test(theme[key]))vars[name]=theme[key];
  const fonts:Record<string,string>={Nunito:"'Nunito',Arial,sans-serif",Arial:'Arial,sans-serif',Georgia:'Georgia,serif',Verdana:'Verdana,sans-serif',Comfortaa:"'Comfortaa','Nunito',sans-serif"};if(fonts[theme.font])vars['--site-font']=fonts[theme.font];
  const widths:Record<string,string>={narrow:'1040px',standard:'1260px',wide:'1440px'};if(widths[theme.width])vars['--site-width']=widths[theme.width];
  const scales:Record<string,string>={compact:'.92',standard:'1',large:'1.12'};if(scales[theme.scale])vars['--site-scale']=scales[theme.scale];
  const spaces:Record<string,string>={compact:'.8',standard:'1',relaxed:'1.22'};if(spaces[theme.spacing])vars['--site-spacing']=spaces[theme.spacing];
  const radii:Record<string,string>={soft:'12px',round:'24px',square:'3px'};if(radii[theme.radius])vars['--site-radius']=radii[theme.radius];
  vars['--site-pattern']=theme.backgroundMode==='pattern'?'url("/vodniki-pattern.png")':'none';
  if(!Object.keys(vars).length)return html;const style='<style id="site-builder-theme">:root{'+Object.entries(vars).map(([k,v])=>k+':'+v).join(';')+'}</style>';return html.replace('</head>',style+'</head>');
}
function applyPageModules(html:string,path:string,layout:any) {
  const state=layout?.modules?.[path];if(!state||!Array.isArray(state.order)||path==='/')return html;
  const idsByPath:Record<string,string[]>={
    '/o-tos/':['about-heading','about-nav','about-intro','about-directions','about-chairperson','about-clubs','about-participate','about-activity-2025','about-activity-2024','about-faq'],
    '/novosti/':['news-heading','news-content'],'/meropriyatiya/':['events-heading','events-content'],'/proekty/':['projects-heading','projects-content'],'/dokumenty/':['documents-heading','documents-content'],'/kontakty/':['contacts-heading','contacts-content']
  };
  const ids=idsByPath[path];if(!ids)return html;
  const custom=new Map<string,{id:string;title:string;body:string}>((Array.isArray(layout?.pageCustom?.[path])?layout.pageCustom[path]:[]).map((item:any)=>[item.id,item]));
  const customMarkup=(id:string)=>{const item=custom.get(id);if(!item)return '';const body=escape(String(item.body||'')).replace(/\r?\n/g,'<br>');return path==='/o-tos/'?`<section class="about-section custom-page-module"><h2>${escape(String(item.title||''))}</h2><p>${body}</p></section>`:`<section class="content custom-page-module"><h2>${escape(String(item.title||''))}</h2><p>${body}</p></section>`};
  const mainStart=html.indexOf('<main id="main">'),mainClose=html.indexOf('</main>',mainStart);if(mainStart<0||mainClose<0)return html;
  const mainBody=html.slice(mainStart+'<main id="main">'.length,mainClose);const top=splitTopLevel(mainBody).map(item=>item.html);const blocks=new Map<string,string>();let unknown:string[]=[];
  if(path==='/o-tos/'){
    const heading=top.find(item=>item.includes('class="page-top"'));if(heading)blocks.set('about-heading',heading);
    const shell=top.find(item=>item.includes('about-content'));if(!shell)return html;
    const open=shell.match(/^<[a-zA-Z][^>]*>/)?.[0]||'<section class="content about-content">';const close=shell.match(/<\/([a-zA-Z][\w:-]*)>\s*$/)?.[0]||'</section>';const inner=shell.slice(open.length,shell.length-close.length);
    for(const item of splitTopLevel(inner).map(x=>x.html)){
      let id='';if(item.includes('class="about-contents"'))id='about-nav';
      else {const attr=item.match(/\bid="([^"]+)"/)?.[1];const byId:Record<string,string>={'chto-takoe-tos':'about-intro','chem-zanimaemsya':'about-directions','rukovoditel':'about-chairperson','kruzhki':'about-clubs','kak-uchastvovat':'about-participate','deyatelnost-2025':'about-activity-2025','deyatelnost-2024':'about-activity-2024','voprosy':'about-faq'};id=byId[attr||'']||'';}
      if(id)blocks.set(id,item);else unknown.push(item);
    }
    const arranged=state.order.filter((id:string)=>!state.hidden?.includes(id)).map((id:string)=>blocks.get(id)||customMarkup(id)).join('')+unknown.join('');
    const restored=top.filter(item=>!item.includes('class="page-top"')&&!item.includes('about-content')).join('');const body=(state.hidden?.includes('about-heading')?'':blocks.get('about-heading')||'')+open+arranged+close+restored;
    return html.slice(0,mainStart)+'<main id="main">'+body+'</main>'+html.slice(mainClose+'</main>'.length);
  }
  const expected=ids;for(let i=0;i<Math.min(top.length,expected.length);i++)blocks.set(expected[i],top[i]);
  const arranged=state.order.filter((id:string)=>!state.hidden?.includes(id)).map((id:string)=>blocks.get(id)||customMarkup(id)).join('');
  const used=new Set(expected.slice(0,Math.min(top.length,expected.length)));for(const item of top.slice(expected.length))unknown.push(item);
  return html.slice(0,mainStart)+'<main id="main">'+arranged+unknown.join('')+'</main>'+html.slice(mainClose+'</main>'.length);
}
function applyPageLayout(html:string, path:string, layout:any) {
  const text=layout?.texts?.[path]||{};
  html=html.replace(/<h1([^>]*)>([\s\S]*?)<\/h1>/,(_m:string,attrs:string,original:string)=>`<h1${attrs} data-page-text="title">${typeof text.title==='string'&&text.title?escape(text.title):original}</h1>`);
  html=html.replace(/<p class="lead"([^>]*)>([\s\S]*?)<\/p>/,(_m:string,attrs:string,original:string)=>`<p class="lead"${attrs} data-page-text="lead">${typeof text.lead==='string'&&text.lead?escape(text.lead):original}</p>`);
  if(path!=='/')return html;
  const blocks=splitTopLevel(html); if(!blocks.length)return html;
  const modules=new Map<string,string>(); for(const block of blocks){const id=moduleId(block.html);if(id)modules.set(id,block.html);}
  if(!modules.size)return html;
  const order=Array.isArray(layout?.homeOrder)?layout.homeOrder:homeOrder; const hidden=new Set(Array.isArray(layout?.homeHidden)?layout.homeHidden:[]);
  const custom = new Map<string,{id:string;title:string;body:string}>((Array.isArray(layout?.homeCustom)?layout.homeCustom:[]).map((item:any)=>[item.id,item]));
  const arranged:string[]=[];
  for (const id of order) {
    if (hidden.has(id)) continue;
    const module=modules.get(id); if(module){arranged.push(module);continue;}
    const item=custom.get(id); if(item) arranged.push(`<section class="home-overview custom-home-module"><div class="section-inner"><div class="eyebrow">ТОС «Водники»</div><h2>${escape(String(item.title||''))}</h2><p class="lead">${escape(String(item.body||'')).replace(/\r?\n/g,'<br>')}</p></div></section>`);
  }
  return arranged.join('');
}
function escapeText(value:string) { return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
function editableMarkup(markup:string, scope:string, saved:Record<string,string>) {
  const tokens=markup.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g)||[]; const stack:{name:string;skip:boolean}[]=[]; const seen=new Map<string,number>(); const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']); let output='';
  for(const token of tokens) {
    if(token.startsWith('<!--')) { output+=token; continue; }
    if(token.startsWith('<')) {
      const close=token.match(/^<\/([a-zA-Z][\w:-]*)/); const open=token.match(/^<([a-zA-Z][\w:-]*)/);
      if(close) { const name=close[1].toLowerCase(), index=stack.map(x=>x.name).lastIndexOf(name); if(index>=0)stack.splice(index); output+=token; continue; }
      if(open) { const name=open[1].toLowerCase(), parentSkip=stack.at(-1)?.skip||false, skip=parentSkip||/\bdata-page-text=/.test(token); if(!voidTags.has(name)&&!token.endsWith('/>'))stack.push({name,skip}); }
      output+=token; continue;
    }
    const parent=stack.at(-1); if(!parent||parent.skip||!token.trim()) { output+=token; continue; }
    let hash=2166136261; const seed=parent.name+':'+token.trim().replace(/\s+/g,' '); for(let i=0;i<seed.length;i++)hash=Math.imul(hash^seed.charCodeAt(i),16777619);
    const base='t-'+parent.name+'-'+(hash>>>0).toString(36), count=seen.get(base)||0; seen.set(base,count+1); const key=base+'-'+count; const value=Object.hasOwn(saved,key)?saved[key]:token; const rendered=escapeText(value).replace(/\r?\n/g,'<br>');
    output+=`<span data-site-text="${key}" data-text-scope="${scope}">${rendered}</span>`;
  }
  return output;
}
function applyEditableText(html:string, path:string, layout:any) {
  const shared=layout?.texts?.__shared?.blocks||{}; const page=layout?.texts?.[path]?.blocks||{};
  const mainStart=html.indexOf('<main id="main">'), mainClose=html.indexOf('</main>',mainStart);
  if(mainStart<0||mainClose<0)return html;
  const mainEnd=mainClose+'</main>'.length;
  let before=html.slice(0,mainStart), main=html.slice(mainStart,mainEnd), after=html.slice(mainEnd);
  const skipStart=before.indexOf('<a class="skip"'), headerEnd=before.indexOf('</header>');
  if(skipStart>=0&&headerEnd>=0) { const end=headerEnd+'</header>'.length; before=before.slice(0,skipStart)+editableMarkup(before.slice(skipStart,end),'shared',shared)+before.slice(end); }
  main=editableMarkup(main,'page',page);
  const footerStart=after.indexOf('<footer'), footerEnd=after.indexOf('</footer>');
  if(footerStart>=0&&footerEnd>=0) { const end=footerEnd+'</footer>'.length; after=after.slice(0,footerStart)+editableMarkup(after.slice(footerStart,end),'shared',shared)+after.slice(end); }
  return before+main+after;
}
export async function GET(request:Request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const headers = {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
  if (path === '/admin' || path === '/admin/') return new Response(adminPage,{headers:{...headers,'X-Robots-Tag':'noindex, nofollow'}});
  const known=['/','/o-tos/','/novosti/','/meropriyatiya/','/proekty/','/dokumenty/','/kontakty/'];
  const canonical=path==='/'?'/':path.replace(/\/$/,'')+'/';
  let content:any={news:[],events:[],projects:[],documents:[],contacts:{}};
  try { if(env.DB) { await ensureResearchMaterials(env.DB); content=await readPublic(env.DB); } } catch { /* General information remains available during storage outages. */ }
  const isNews=path.startsWith('/novosti/')&&path!=='/novosti/';
  const exists=known.includes(canonical)||(isNews&&content.news.some((n:any)=>n.slug===decodeSegment(path.split('/')[2])));
  const category=url.searchParams.get('category');
  const renderData=canonical==='/novosti/'&&category&&category!=='Все'?{...content,news:content.news.filter((n:any)=>n.category===category)}:content;
  const rendered=renderPublic(renderData,path);
  let main=rendered.html.replace(/<button class="(active|)" data-category="([^"]+)">([^<]+)<\/button>/g,(_m:string,_active:string,c:string,label:string)=>`<a class="category-link ${(category||'Все')===c?'active':''}" href="/novosti/?category=${encodeURIComponent(c)}">${label}</a>`);
  if(canonical==='/kontakty/') {
    const c={...content.contacts,phone:content.contacts.phone||'+7 919 706-13-93',email:content.contacts.email||'9977886@mail.ru'}; const details=[c.phone?'<p><b>Телефон:</b> '+escape(c.phone)+'</p>':'',c.email?'<p><b>Электронная почта:</b> '+escape(c.email)+'</p>':'',c.hours?'<p><b>Часы приёма:</b> '+escape(c.hours)+'</p>':''].join('');
    if(details)main=main.replace('<p>Телефон, электронная почта и часы приёма будут добавлены после подтверждения.</p>',details+(c.source?'<p class="source-note">Телефон и электронная почта приведены в <a href="/report-2024.png" target="_blank" rel="noopener">публичном отчёте за 2024 год</a>. Часы приёма уточняйте перед визитом.</p>':''));
  }
  main=main.replace('<div class="water" aria-hidden="true"></div>','<div class="neighborhood-art" aria-hidden="true"><img src="/neighborhood.svg" width="600" height="500" alt="" fetchpriority="high"></div>');
  main=applyPageLayout(main,canonical,content.layout);
  let pageShell=template.replace(/<main id="main">[\s\S]*?<\/main>/,'<main id="main">'+main+'</main>');
  pageShell=applyPageModules(pageShell,canonical,content.layout);
  pageShell=applyTheme(pageShell,content.layout);
  let html=pageShell
    .replace(/<title>[\s\S]*?<\/title>/,'<title>'+escape(rendered.title)+'</title>')
    .replace('<script src="/app.js"></script>','')
    .replace('/style.css?v=3','/style.css?v=4')
;
  html=html.replace(/<nav id="nav"[\s\S]*?<\/nav>/,nav=>nav.replace(/<a href="([^"]+)"/g,(tag,href)=>canonical===href||(isNews&&href==='/novosti/')?tag+' aria-current="page"':tag));
  html=applyEditableText(html,canonical,content.layout);
  if(path==='/content.json')return Response.json(content,{headers:{'Cache-Control':'no-store'}});
  return new Response(html,{status:exists?200:404,headers});
}
