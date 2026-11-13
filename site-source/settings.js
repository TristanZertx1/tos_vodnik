// Site settings: reduced motion, collapsing header and the navigation icons.
(function () {
  var root = document.documentElement;
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } }

  // Liquid Glass refraction filter, used by backdrop-filter on the top-panel buttons (Chromium-based browsers)
  var NS = 'http://www.w3.org/2000/svg';
  var defs = document.createElementNS(NS, 'svg');
  defs.setAttribute('width', '0'); defs.setAttribute('height', '0'); defs.setAttribute('aria-hidden', 'true');
  defs.style.position = 'absolute';
  defs.innerHTML = '<filter id="liquid-glass" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">'+
    '<feImage href="/liquid-noise.png" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"/>'+
    '<feGaussianBlur in="map" stdDeviation="3" result="smooth"/>'+
    '<feDisplacementMap in="SourceGraphic" in2="smooth" scale="34" xChannelSelector="R" yChannelSelector="G" result="refract"/>'+
    '<feSpecularLighting in="smooth" surfaceScale="3" specularConstant="0.9" specularExponent="28" lighting-color="#ffffff" result="spec">'+
    '<fePointLight x="-40" y="-60" z="160"/></feSpecularLighting>'+
    '<feComposite in="refract" in2="spec" operator="arithmetic" k1="0" k2="1" k3="0.25" k4="0"/>'+
    '</filter>';
  document.body.appendChild(defs);

  var ICONS = {
    '/': '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    '/o-tos': '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    '/novosti': '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    '/meropriyatiya': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    '/proekty': '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    '/dokumenty': '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    '/kontakty': '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>'
  };
  var GEAR = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>';
  function icon(paths, cls) {
    return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }

  // Motion
  function setReduced(on) {
    root.classList.toggle('motion-reduced', on);
    save('vodniki-motion', on ? 'reduced' : 'full');
  }

  // Navigation: icons and the settings button inside the floating pill
  var nav = document.getElementById('nav');
  if (nav) {
    nav.querySelectorAll('a').forEach(function (a) {
      var p = ICONS[a.getAttribute('href')];
      if (p) a.insertAdjacentHTML('afterbegin', icon(p, 'nav-ico'));
    });
  }

  function makeButton(cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.setAttribute('aria-label', 'Настройки сайта');
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'settings-panel');
    b.innerHTML = icon(GEAR, 'nav-ico-gear');
    return b;
  }
  var buttons = [];
  if (nav) { var b1 = makeButton('nav-settings'); nav.appendChild(b1); buttons.push(b1); }
  var menu = document.getElementById('menu-toggle');
  if (menu && menu.parentNode) {
    var b2 = makeButton('settings-mobile');
    menu.parentNode.insertBefore(b2, menu.nextSibling);
    buttons.push(b2);
  }

  // Tab feedback: the clicked tab lights up at once, a progress bar shows while the next page loads,
  // and the page is prefetched when the pointer reaches a tab.
  var progress = document.createElement('div');
  progress.className = 'nav-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progress);
  if (nav) {
    nav.querySelectorAll('a').forEach(function (a) {
      var href = a.getAttribute('href');
      a.addEventListener('pointerenter', function () {
        if (document.querySelector('link[data-prefetch="' + href + '"]')) return;
        var l = document.createElement('link');
        l.rel = 'prefetch';
        l.href = href;
        l.dataset.prefetch = href;
        document.head.appendChild(l);
      }, { once: true });
      a.addEventListener('click', function (e) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (href === window.location.pathname) return;
        nav.querySelectorAll('a').forEach(function (x) { x.removeAttribute('aria-current'); });
        a.setAttribute('aria-current', 'page');
        document.body.classList.add('nav-loading');
      });
    });
  }

  // Settings panel
  var panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.className = 'settings-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'settings-title');
  panel.hidden = true;
  panel.innerHTML =
    '<div class="settings-head"><h2 id="settings-title">Настройки сайта</h2>' +
    '<button type="button" class="settings-close" aria-label="Закрыть настройки">×</button></div>' +
    '<section class="settings-tools" aria-labelledby="settings-tools-title"><h3 id="settings-tools-title">Разделы и возможности</h3>' +'<a href="/ideya"><span class="settings-tool-icon" aria-hidden="true">✳</span><span><strong>Предложить идею</strong><small>Инициатива для нашего района</small></span><span class="settings-tool-arrow" aria-hidden="true">↗</span></a>' +'<a href="/podpiska"><span class="settings-tool-icon" aria-hidden="true">✉</span><span><strong>Подписка на новости</strong><small>Новые публикации по почте</small></span><span class="settings-tool-arrow" aria-hidden="true">↗</span></a>' +'</section>' +'<label class="settings-row"><span>Уменьшить анимацию</span><input type="checkbox" id="motion-toggle"></label>' +
    '<fieldset class="settings-group"><legend>Доступность</legend><div class="settings-access"></div></fieldset>';
  document.body.appendChild(panel);
  // The accessibility switch lives in the settings panel now (same element, so its behaviour is unchanged)
  var access = document.querySelector('.access-bar');
  var accessSlot = panel.querySelector('.settings-access');
  if (access && accessSlot) accessSlot.appendChild(access);

  function openPanel(open) {
    panel.hidden = !open;
    buttons.forEach(function (b) { b.setAttribute('aria-expanded', String(open)); });
    if (open) panel.querySelector('.settings-close').focus();
  }
  buttons.forEach(function (b) { b.addEventListener('click', function () { openPanel(panel.hidden); }); });
  panel.querySelector('.settings-close').addEventListener('click', function () { openPanel(false); buttons[0] && buttons[0].focus(); });
  var motion = document.getElementById('motion-toggle');
  motion.checked = load('vodniki-motion') === 'reduced';
  motion.addEventListener('change', function () { setReduced(motion.checked); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) openPanel(false); });
  document.addEventListener('click', function (e) {
    if (!panel.hidden && !panel.contains(e.target) && !buttons.some(function (b) { return b.contains(e.target); })) openPanel(false);
  });

  // Collapsing header with hysteresis: folds after 200px down, unfolds only above 90px.
  // No direction check and no animated height, so it cannot flip back and forth at the threshold.
  window.addEventListener('scroll', function () {
    var y = window.scrollY;
    var compact = root.classList.contains('is-compact');
    if (!compact && y > 200) root.classList.add('is-compact');
    else if (compact && y < 90) root.classList.remove('is-compact');
  }, { passive: true });

  // Rounding fallback for browsers without scroll-driven animations (Firefox, older Safari).
  // Same range as the CSS version: 6px at the bottom edge of the viewport, 28px once the module is well inside it.
  var supportsTimeline = window.CSS && CSS.supports && CSS.supports('animation-timeline: view()');
  if (!supportsTimeline && !root.classList.contains('motion-reduced')) {
    var moduleSelector = '.card:not(.feed-card),.feed-card,.overview-card,.empty,.event-signup,.policy-content,.explanation-grid article,.faq-list details,.vk-qr-card,.report-details,.source-details,.about-contents,.chairperson,.hero-inner,.home-quick a';
    var queued = false;
    var roundModules = function () {
      queued = false;
      var h = window.innerHeight || 1;
      document.querySelectorAll(moduleSelector).forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.height === 0) return;
        var t = Math.min(1, Math.max(0, (h - r.top) / (h * 0.55)));
        el.style.borderRadius = (6 + 22 * t).toFixed(1) + 'px';
      });
    };
    var queue = function () { if (!queued) { queued = true; requestAnimationFrame(roundModules); } };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    queue();
  }
})();
