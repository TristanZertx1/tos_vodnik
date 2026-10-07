(() => {
  const path = location.pathname === '/' ? '/' : `${location.pathname.replace(/\/+$/, '')}/`;
  const pageKey = path;
  const main = document.querySelector('main');
  if (!main) return;

  const makeCustom = item => {
    const section = document.createElement('section');
    section.className = 'section builder-custom-module';
    section.dataset.builderCustom = item.id;
    const card = document.createElement('article');
    card.className = 'card';
    const title = document.createElement('h2');
    title.textContent = item.title || 'Новый блок';
    const body = document.createElement('p');
    body.style.whiteSpace = 'pre-line';
    body.textContent = item.body || '';
    card.append(title, body);
    section.append(card);
    return section;
  };

  const apply = data => {
    const layout = data?.layout || {};
    const theme = layout.theme || {};
    const root = document.documentElement;
    root.classList.add('site-builder-theme');
    const colorVars = {
      primary: '--site-primary', accent: '--site-accent', ink: '--site-ink',
      muted: '--site-muted', pageBackground: '--site-background', surface: '--site-surface',
      border: '--site-border', tint: '--site-tint'
    };
    for (const [key, variable] of Object.entries(colorVars)) {
      if (/^#[\da-f]{6}$/i.test(theme[key] || '')) root.style.setProperty(variable, theme[key]);
    }
    const fonts = { Nunito: "'Nunito', Arial, sans-serif", Arial: 'Arial, sans-serif', Georgia: 'Georgia, serif', Verdana: 'Verdana, sans-serif', Comfortaa: "'Comfortaa', Arial, sans-serif" };
    if (fonts[theme.font]) root.style.setProperty('--site-font', fonts[theme.font]);
    root.style.setProperty('--site-width', ({ narrow: '1040px', standard: '1260px', wide: '1440px' })[theme.width] || '1260px');
    root.style.setProperty('--site-scale', ({ compact: '.92', standard: '1', large: '1.2' })[theme.scale] || '1');
    root.style.setProperty('--site-spacing', ({ compact: '.78', standard: '1', relaxed: '1.2' })[theme.spacing] || '1');
    root.style.setProperty('--site-radius', ({ soft: '12px', round: '24px', square: '3px' })[theme.radius] || '12px');
    root.style.setProperty('--site-pattern', theme.backgroundMode === 'pattern' ? "url('/vodniki-pattern.png')" : 'none');

    const sharedBlocks = layout.texts?.__shared?.blocks || {};
    for (const [id, value] of Object.entries(sharedBlocks)) {
      const target = [...document.querySelectorAll('[data-site-text]')].find(el => el.dataset.siteText === id);
      if (target) target.textContent = value;
    }
    const textState = layout.texts?.[pageKey] || {};
    if (textState.title) {
      const title = main.querySelector('[data-page-text="title"]') || main.querySelector('.page-top h1') || main.querySelector('.hero h1');
      if (title) title.textContent = textState.title;
    }
    if (textState.lead) {
      const lead = main.querySelector('[data-page-text="lead"]') || main.querySelector('.page-top .lead') || main.querySelector('.hero .lead');
      if (lead) lead.textContent = textState.lead;
    }
    const blocks = textState.blocks || {};
    for (const [id, value] of Object.entries(blocks)) {
      const target = [...document.querySelectorAll('[data-site-text]')].find(el => el.dataset.siteText === id);
      if (target) target.textContent = value;
    }

    const show = (element, visible) => {
      if (!element) return;
      element.hidden = !visible;
      if (visible) element.style.removeProperty('display');
      else element.style.setProperty('display', 'none', 'important');
    };
    const home = pageKey === '/';
    const customItems = home ? (layout.homeCustom || []) : (layout.pageCustom?.[pageKey] || []);
    const customNodes = new Map(customItems.map(item => [item.id, makeCustom(item)]));
    if (home) {
      const children = [...main.children];
      const nodes = {
        hero: main.querySelector('.hero'), quick: main.querySelector('.quick'),
        overview: main.querySelector('.home-overview'),
        news: children.find(el => el.classList.contains('tint') && el.querySelector('a[href^="/novosti"]')),
        events: children.find(el => el !== main.querySelector('.hero') && el.querySelector('a[href^="/meropriyatiya"]')),
        projects: children.find(el => el.querySelector('a[href^="/proekty"]')),
        join: children.find(el => el.classList.contains('join') || /Есть вопрос|Присоединяйтесь/.test(el.textContent))
      };
      const state = layout.modules?.['/'] || { order: layout.homeOrder || Object.keys(nodes), hidden: layout.homeHidden || [] };
      const order = state.order || layout.homeOrder || Object.keys(nodes);
      const hidden = new Set(state.hidden || layout.homeHidden || []);
      for (const id of Object.keys(nodes)) show(nodes[id], !hidden.has(id));
      const moved = new Set();
      for (const id of order) {
        const element = nodes[id] || customNodes.get(id);
        if (element && !moved.has(element)) { main.append(element); moved.add(element); }
      }
      for (const element of children) if (!moved.has(element)) main.append(element);
    } else if (pageKey === '/o-tos/') {
      const container = main.querySelector('.about-content, .content');
      const state = layout.modules?.[pageKey] || {};
      const nodes = {
        'about-heading': main.querySelector('.page-top'),
        'about-nav': container?.querySelector('.about-contents'),
        'about-intro': container?.querySelector('#chto-takoe-tos'),
        'about-directions': container?.querySelector('#chem-zanimaemsya'),
        'about-chairperson': container?.querySelector('#rukovoditel'),
        'about-clubs': container?.querySelector('#kruzhki'),
        'about-participate': container?.querySelector('#kak-uchastvovat'),
        'about-activity-2025': container?.querySelector('#deyatelnost-2025'),
        'about-activity-2024': container?.querySelector('#deyatelnost-2024'),
        'about-faq': container?.querySelector('#voprosy')
      };
      for (const [id, element] of Object.entries(nodes)) show(element, !(state.hidden || []).includes(id));
      const order = (state.order || Object.keys(nodes)).filter(id => id !== 'about-heading');
      const movable = new Set(Object.entries(nodes).filter(([id, el]) => id !== 'about-heading' && el?.parentElement === container).map(([,el]) => el));
      const extra = [...(container?.children || [])].filter(el => !movable.has(el) && !el.matches('.builder-custom-module'));
      for (const el of movable) el.remove();
      for (const el of customNodes.values()) el.remove();
      for (const id of order) {
        const el = nodes[id] || customNodes.get(id);
        if (el && id !== 'about-heading') container?.append(el);
      }
      for (const el of extra) container?.append(el);
    } else {
      const type = pageKey === '/novosti/' ? 'news' : pageKey === '/meropriyatiya/' ? 'events' : pageKey === '/proekty/' ? 'projects' : pageKey === '/dokumenty/' ? 'documents' : 'contacts';
      const state = layout.modules?.[pageKey] || {};
      const nodes = { [`${type}-heading`]: main.querySelector('.page-top'), [`${type}-content`]: main.querySelector('.content') };
      for (const [id, element] of Object.entries(nodes)) show(element, !(state.hidden || []).includes(id));
      const order = state.order || Object.keys(nodes);
      const rest = [...main.children].filter(el => !Object.values(nodes).includes(el));
      for (const id of order) { const el = nodes[id] || customNodes.get(id); if (el) main.append(el); }
      for (const el of rest) main.append(el);
    }
    if (customItems.length && home) {
      for (const item of customItems) {
        const el = customNodes.get(item.id);
        if (el && !el.isConnected) main.append(el);
        show(el, !(layout.modules?.['/']?.hidden || layout.homeHidden || []).includes(item.id));
      }
    }
  };

  let started = false;
  const loadLayout = () => {
    if (started) return;
    started = true;
    fetch('/api/public/content?fresh=' + Date.now(), { cache: 'no-store', headers: { Accept: 'application/json' } }).then(response => {
      if (!response.ok) throw new Error('Не удалось загрузить оформление сайта');
      return response.json();
    }).then(apply).catch(error => console.warn('[site-layout]', error));
  };
  if (document.documentElement.dataset.siteContentReady === 'true') {
    loadLayout();
  } else {
    const observer = new MutationObserver(() => {
      if (document.documentElement.dataset.siteContentReady === 'true') {
        observer.disconnect();
        loadLayout();
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-site-content-ready'] });
    setTimeout(() => {
      observer.disconnect();
      loadLayout();
    }, 8000);
  }
})();
