(() => {
  'use strict';
  const main = document.querySelector('main');
  if (!main) return;
  const mapUrl = 'https://yandex.com/maps/50/perm/category/landmark_attraction/89683368508/?filter=alternate_vertical%3ARequestWindow&ll=56.035168%2C58.030391&sctx=ZAAAAAgBEAAaKAoSCUeum1JeHUxAEWMOgo5WAU1AEhIJzy10JQJV6z8RE%2FHW%2BbfL0z8iBgABAgMEBSgKOABAhq8HSAFqAnJ1nQHNzMw9oAEAqAEAvQFjOhZEwgES%2Fb%2B4wccCrvOAn8oDiYCQ%2FcABggIZY2F0ZWdvcnlfaWQ6KDg5NjgzMzY4NTA4KYoCCzg5NjgzMzY4NTA4kgIAmgIMZGVza3RvcC1tYXBz&sll=56.033213%2C58.029490&sspn=0.053201%2C0.017758&z=13.6';
  const categories = ['Благоустройство', 'Общественные пространства', 'Мероприятия', 'Культура и спорт', 'Безопасность', 'Другое'];
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const el = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text != null) item.textContent = text;
    if (className) item.className = className;
    return item;
  };
  const sectionHeading = (title, lead) => {
    const top = el('div', null, 'page-top');
    top.append(el('div', 'ТОС «Водники»', 'eyebrow'), el('h1', title), el('p', lead, 'lead'));
    return top;
  };
  const content = () => {
    const wrapper = el('section', null, 'content community-page');
    return wrapper;
  };
  function addNavigation() {
    const nav = document.querySelector('#nav');
    if (!nav) return;
    const links = [['Карта','/karta'],['Поиск','/poisk'],['Предложить идею','/ideya'],['Подписка','/podpiska']];
    links.forEach(([label, href]) => {
      if (nav.querySelector('a[href="' + href + '"]')) return;
      const anchor = el('a', label);
      anchor.href = href;
      anchor.dataset.communityNav = 'true';
      nav.append(anchor);
    });
    const path = location.pathname.replace(/\/+$/, '') || '/';
    nav.querySelectorAll('a').forEach(anchor => {
      if (anchor.dataset.communityNav) {
        if (anchor.getAttribute('href') === path) anchor.setAttribute('aria-current', 'page');
        else anchor.removeAttribute('aria-current');
      }
    });
  }
  function addPolicyDetails() {
    if ((location.pathname.replace(/\/+$/, '') || '/') !== '/politika' || main.querySelector('[data-community-policy]')) return;
    const block = el('section', null, 'community-policy content');
    block.dataset.communityPolicy = 'true';
    block.append(
      el('h2', 'Обращения и предложения жителей'),
      el('p', 'Если вы отправляете предложение через форму сайта, ТОС обрабатывает указанные вами имя, категорию, описание, место и, если вы его оставили, адрес электронной почты. Цель обработки — рассмотреть инициативу и связаться с вами по указанному адресу. Основание — ваше отдельное согласие, которое отмечается в форме.'),
      el('p', 'Доступ к предложениям имеют уполномоченные администраторы сайта. Предложение можно удалить или отозвать, обратившись по электронной почте, указанной в разделе контактов. Не указывайте в форме сведения о здоровье, политических взглядах и другие чувствительные персональные данные.')
    );
    main.append(block);
  }
  function renderMap() {
    main.replaceChildren(sectionHeading('Карта Перми и района Водники', 'Ориентируйтесь на карте, находите достопримечательности и места, которые могут стать точками добрых инициатив.'));
    const body = content();
    const map = el('div', null, 'community-map');
    const frame = el('iframe');
    frame.title = 'Интерактивная карта Перми';
    frame.src = 'https://yandex.ru/map-widget/v1/?ll=56.035168%2C58.030391&z=13';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    map.append(frame);
    const actions = el('div', null, 'community-map-actions');
    const categoryLink = el('a', 'Достопримечательности Перми ↗', 'button');
    categoryLink.href = mapUrl;
    categoryLink.target = '_blank';
    categoryLink.rel = 'noopener noreferrer';
    const allMap = el('a', 'Открыть Яндекс Карты ↗', 'text-link');
    allMap.href = 'https://yandex.ru/maps/50/perm/';
    allMap.target = '_blank';
    allMap.rel = 'noopener noreferrer';
    actions.append(categoryLink, allMap);
    body.append(el('h2', 'Исследуйте город'), map, actions, el('p', 'Карта показывает общий район Перми. Адреса мероприятий и координаты инициатив можно будет добавлять по мере наполнения сайта подтверждёнными данными.', 'source-note'));
    main.append(body);
  }
  async function renderSearch() {
    main.replaceChildren(sectionHeading('Поиск по сайту', 'Найдите новости, мероприятия, проекты и опубликованные документы.'));
    const body = content();
    const label = el('label', 'Поисковый запрос');
    const input = el('input');
    input.type = 'search';
    input.placeholder = 'Например, благоустройство или праздник';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Поиск по новостям, мероприятиям, проектам и документам');
    const status = el('p', 'Загружаю материалы…', 'community-search-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const results = el('div', null, 'community-search-results');
    label.append(input);
    body.append(label, status, results);
    main.append(body);
    let records = [];
    try {
      const response = await window.vodnikiApiFetch('/api/public/content?fresh=' + Date.now(), {cache:'no-store', headers:{Accept:'application/json'}});
      if (!response.ok) throw new Error('Не удалось загрузить публикации.');
      const data = await response.json();
      records = []
        .concat((data.news || []).map(item => ({...item, type:'news', label:'Новость', href:'/novosti/' + encodeURIComponent(item.slug || '')})))
        .concat((data.events || []).map(item => ({...item, type:'events', label:'Мероприятие', href:'/meropriyatiya/' + encodeURIComponent(item.id || '')})))
        .concat((data.projects || []).map(item => ({...item, type:'projects', label:'Проект', href:'/proekty'})))
        .concat((data.documents || []).map(item => ({...item, type:'documents', label:'Документ', href:item.url || '/dokumenty'})));
      status.textContent = records.length ? 'Материалы загружены. Введите слово или фразу.' : 'Опубликованных материалов пока нет.';
    } catch (error) {
      status.textContent = error.message || 'Поиск временно недоступен.';
      return;
    }
    const draw = () => {
      const query = input.value.trim().toLocaleLowerCase('ru');
      results.replaceChildren();
      if (!query) return;
      const found = records.filter(item => [item.title,item.description,item.body,item.category,item.status,item.date,item.place,item.participation].join(' ').toLocaleLowerCase('ru').includes(query)).slice(0, 50);
      status.textContent = found.length ? 'Найдено: ' + found.length : 'Ничего не найдено. Попробуйте изменить запрос.';
      found.forEach(item => {
        const card = el('article', null, 'card community-result');
        card.append(el('p', item.label + (item.date ? ' · ' + item.date : ''), 'meta'), el('h3', item.title || 'Без названия'), el('p', item.description || item.body || ''));
        const anchor = el('a', 'Открыть материал →', 'text-link');
        let href = item.href;
        if (item.type === 'documents') {
          try { const url = new URL(href, location.origin); href = ['http:','https:'].includes(url.protocol) ? url.href : '/dokumenty'; }
          catch { href = '/dokumenty'; }
          if (href.startsWith('http')) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
        }
        anchor.href = href;
        card.append(anchor);
        results.append(card);
      });
    };
    input.addEventListener('input', draw);
  }
  function renderIdeaForm() {
    main.replaceChildren(sectionHeading('Предложить идею', 'Расскажите, что можно улучшить в микрорайоне. Каждое обращение попадёт в закрытый раздел панели администратора.'));
    const body = content();
    const form = el('form', null, 'community-idea-form');
    form.noValidate = false;
    const fields = [
      ['name','Ваше имя','text',true,'Как к вам обращаться?'],
      ['email','Электронная почта (необязательно)','email',false,'name@example.ru'],
      ['location','Место или адрес (необязательно)','text',false,'Улица, двор, ориентир']
    ];
    fields.forEach(([name,label,type,required,placeholder]) => {
      const wrap = el('label', label);
      const input = el('input');
      input.name = name;
      input.type = type;
      input.required = required;
      input.maxLength = name === 'name' ? 100 : name === 'email' ? 254 : 180;
      input.placeholder = placeholder;
      if (name === 'name') input.autocomplete = 'name';
      if (name === 'email') input.autocomplete = 'email';
      wrap.append(input);
      form.append(wrap);
    });
    const categoryWrap = el('label', 'Категория предложения');
    const category = el('select');
    category.name = 'category';
    category.required = true;
    category.append(new Option('Выберите категорию',''));
    categories.forEach(value => category.append(new Option(value,value)));
    categoryWrap.append(category);
    const descriptionWrap = el('label', 'Опишите вашу идею');
    const description = el('textarea');
    description.name = 'description';
    description.required = true;
    description.minLength = 20;
    description.maxLength = 3000;
    description.rows = 6;
    description.placeholder = 'Что предлагаете сделать и какую проблему это поможет решить?';
    descriptionWrap.append(description);
    const trap = el('label', 'Оставьте это поле пустым', 'community-honeypot');
    const website = el('input');
    website.name = 'website';
    website.tabIndex = -1;
    website.autocomplete = 'off';
    trap.append(website);
    const consentWrap = el('label', null, 'community-consent');
    const consent = el('input');
    consent.type = 'checkbox';
    consent.name = 'consent';
    consent.required = true;
    const consentText = el('span', 'Согласен(на) на обработку указанных данных для рассмотрения предложения и связи со мной. ');
    const policy = el('a', 'Политика обработки персональных данных');
    policy.href = '/politika';
    consentText.append(policy);
    consentWrap.append(consent, consentText);
    const submit = el('button', 'Отправить предложение', 'button');
    submit.type = 'submit';
    const status = el('p', '', 'community-form-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.append(categoryWrap, descriptionWrap, trap, consentWrap, submit, status);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true;
      status.textContent = 'Отправляем предложение…';
      const payload = Object.fromEntries(new FormData(form));
      payload.consent = consent.checked;
      try {
        const response = await window.vodnikiApiFetch('/api/public/ideas', {
          method:'POST',
          headers:{'Content-Type':'application/json',Accept:'application/json'},
          body:JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось отправить предложение.');
        form.reset();
        status.textContent = 'Спасибо! Предложение сохранено и передано на рассмотрение ТОС.';
      } catch (error) {
        status.textContent = error.message || 'Ошибка отправки. Попробуйте позже.';
      } finally {
        submit.disabled = false;
      }
    });
    body.append(el('p', 'Пожалуйста, не указывайте в сообщении пароли, данные банковских карт и чувствительные сведения.'), form);
    main.append(body);
  }

  function renderNewsletter() {
    main.replaceChildren(sectionHeading('Подписка на новости', 'Получайте письма о новых публикациях, мероприятиях и проектах ТОС «Водники».'));
    const body = content();
    const form = el('form', null, 'community-newsletter-form');
    const queryStatus = new URLSearchParams(location.search).get('status');
    const status = el('p', '', 'community-form-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    if (queryStatus === 'confirmed') status.textContent = 'Подписка подтверждена. Теперь вы будете получать письма о новых публикациях.';
    if (queryStatus === 'unsubscribed') status.textContent = 'Вы отписались от рассылки. Письма о новых публикациях больше приходить не будут.';
    const label = el('label', 'Ваш адрес электронной почты');
    const email = el('input');
    email.type = 'email';
    email.name = 'email';
    email.required = true;
    email.maxLength = 254;
    email.autocomplete = 'email';
    email.placeholder = 'name@example.ru';
    label.append(email);
    const trap = el('label', 'Оставьте это поле пустым', 'community-honeypot');
    const website = el('input');
    website.name = 'website';
    website.tabIndex = -1;
    website.autocomplete = 'off';
    trap.append(website);
    const consentWrap = el('label', null, 'community-consent');
    const consent = el('input');
    consent.type = 'checkbox';
    consent.required = true;
    const consentText = el('span', 'Согласен(на) получать информационные письма и на обработку адреса электронной почты для рассылки. ');
    const policy = el('a', 'Политика обработки персональных данных');
    policy.href = '/politika';
    consentText.append(policy);
    consentWrap.append(consent, consentText);
    const submit = el('button', 'Подписаться', 'button');
    submit.type = 'submit';
    form.append(label, trap, consentWrap, submit, status);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true;
      status.textContent = 'Отправляем письмо для подтверждения…';
      try {
        const response = await window.vodnikiApiFetch('/api/public/newsletter/subscribe', {
          method:'POST',
          headers:{'Content-Type':'application/json',Accept:'application/json'},
          body:JSON.stringify({email:email.value,website:website.value,consent:consent.checked})
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось оформить подписку.');
        form.reset();
        status.textContent = 'Если адрес можно подписать, на него отправлено письмо. Перейдите по ссылке в письме, чтобы подтвердить подписку.';
      } catch (error) {
        status.textContent = error.message || 'Подписка временно недоступна. Попробуйте позже.';
      } finally {
        submit.disabled = false;
      }
    });
    body.append(el('p', 'Подписка оформляется только после подтверждения по ссылке из письма. В каждом письме будет ссылка для отписки.'), form);
    main.append(body);
  }
  function renderFeaturePage() {
    addNavigation();
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/karta' || path === '/poisk' || path === '/ideya' || path === '/podpiska') {
      if (main.dataset.communityPage === path && main.querySelector('.community-page')) return;
      main.dataset.communityPage = path;
      if (path === '/karta') renderMap();
      if (path === '/poisk') renderSearch();
      if (path === '/ideya') renderIdeaForm();
      if (path === '/podpiska') renderNewsletter();
    } else {
      delete main.dataset.communityPage;
      addPolicyDetails();
    }
  }
  const observer = new MutationObserver(renderFeaturePage);
  observer.observe(main, {childList:true, subtree:true});
  renderFeaturePage();
  window.addEventListener('popstate', () => { delete main.dataset.communityPage; renderFeaturePage(); });
})();
