const progress = document.querySelector('#scroll-progress');
const header = document.querySelector('.site-header');
const menuToggle = document.querySelector('#menu-toggle');
const siteNav = document.querySelector('#nav');
function setMenuOpen(open) {
  menuToggle?.setAttribute('aria-expanded', String(open));
  siteNav?.classList.toggle('open', open);
}
menuToggle?.addEventListener('click', () => setMenuOpen(menuToggle.getAttribute('aria-expanded') !== 'true'));
siteNav?.addEventListener('click', event => {
  if (event.target.closest('a')) setMenuOpen(false);
});
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const vision = document.querySelector('#vision');
const hero = document.querySelector('.hero-inner');
const heroArt = document.querySelector('.hero .water, .neighborhood-art');
const toTop = document.querySelector('.back-to-top');
const motionEnabled = () => !reducedMotion.matches && !vision?.checked;
let pending = false;
const animated = new Set();
function updateScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  if (progress) progress.style.width = (max > 0 ? Math.min(100, scrollY / max * 100) : 0) + '%';
  header?.classList.toggle('has-scrolled', scrollY > 20);
  toTop?.classList.toggle('is-visible', scrollY > 350);
  hero?.style.setProperty('--hero-offset', motionEnabled() ? Math.min(scrollY * .08, 35) + 'px' : '0px');
  heroArt?.style.setProperty('--art-offset', motionEnabled() ? -Math.min(scrollY * .09, 48) + 'px' : '0px');
  pending = false;
}
addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(updateScroll); } }, { passive: true });
addEventListener('resize', updateScroll);
updateScroll();
const stopMotion = () => { if (reducedMotion.matches || vision?.checked) { for (const animation of animated) animation.cancel(); animated.clear(); document.querySelectorAll('.site-tilt-active').forEach(element => element.classList.remove('site-tilt-active')); document.querySelector('.neighborhood-art img')?.style.setProperty('--pointer-x','0px'); document.querySelector('.neighborhood-art img')?.style.setProperty('--pointer-y','0px'); } updateScroll(); };
vision?.addEventListener('change', stopMotion);
reducedMotion.addEventListener('change', stopMotion);
if ('IntersectionObserver' in window && 'animate' in Element.prototype) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      if (reducedMotion.matches || vision?.checked) continue;
      const animation = entry.target.animate([
        { opacity: .7, transform: 'translateY(14px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 580, delay: entry.target.matches('.card') ? Math.min(Array.from(entry.target.parentElement.children).indexOf(entry.target), 4) * 85 : 0, easing: 'cubic-bezier(.2,.7,.2,1)' });
      animated.add(animation); animation.finished.catch(() => {}).finally(() => animated.delete(animation));
    }
  }, { threshold: .12 });
  document.querySelectorAll('.section-head, .intro > div, .hero-inner > *, .content > h2, .card, .overview-card, .explanation-grid article, .history-list article, .join, .empty').forEach(element => observer.observe(element));
}
// Native details work without JavaScript; these controls are optional enhancements.
for (const group of document.querySelectorAll('[data-faq-group]')) {
  const details = [...group.querySelectorAll('details')];
  const bar = document.createElement('div'); bar.className = 'faq-toolbar';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'faq-toggle';
  const label = () => { button.textContent = details.every(item => item.open) ? 'Свернуть все ответы' : 'Показать все ответы'; };
  button.addEventListener('click', () => { const open = !details.every(item => item.open); details.forEach(item => { item.open = open; }); label(); });
  details.forEach(item => item.addEventListener('toggle', label)); label(); bar.append(button); group.before(bar);
}
for (const detail of document.querySelectorAll('.faq-list details')) {
  detail.addEventListener('toggle', () => {
    if (!detail.open || !motionEnabled() || !('animate' in Element.prototype)) return;
    for (const child of detail.children) {
      if (child.tagName === 'SUMMARY') continue;
      const animation = child.animate([{opacity:.5,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,easing:'ease-out'});
      animated.add(animation); animation.finished.catch(() => {}).finally(() => animated.delete(animation));
    }
  });
}
const contentsLinks = [...document.querySelectorAll('.about-contents a[href^="#"]')];
function updateContents() {
  if (!contentsLinks.length) return;
  let current = contentsLinks[0];
  for (const link of contentsLinks) {
    const target = document.getElementById(link.hash.slice(1));
    if (target && target.getBoundingClientRect().top <= 170) current = link;
  }
  for (const link of contentsLinks) { if (link === current) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); }
}
let contentsPending = false;
addEventListener('scroll', () => { if (!contentsPending) { contentsPending = true; requestAnimationFrame(() => { updateContents(); contentsPending = false; }); } }, {passive:true});
updateContents();

document.addEventListener('submit', async event => {
  const form = event.target.closest?.('[data-event-registration]');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector('.registration-message');
  if (button) button.disabled = true;
  if (status) status.textContent = 'Отправляем заявку…';
  try {
    const response = await window.vodnikiApiFetch('/api/public/events/' + encodeURIComponent(form.dataset.eventId) + '/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(form))) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось записаться.');
    form.hidden = true;
    const availability = document.querySelectorAll('[data-event-availability="' + CSS.escape(form.dataset.eventId) + '"]');
    availability.forEach(item => { item.textContent = 'Занято мест: ' + result.registered + '. Свободно: ' + result.available + '.'; });
    document.querySelectorAll('[data-event-registration][data-event-id="' + CSS.escape(form.dataset.eventId) + '"]').forEach(other => {
      const select = other.querySelector('[name="seats"]');
      const submit = other.querySelector('button[type="submit"]');
      if (select && result.available < 1) { select.disabled = true; if (submit) submit.disabled = true; }
      else if (select) { [...select.options].forEach(option => { option.disabled = Number(option.value) > result.available; }); if (submit) submit.disabled = false; }
    });
  } catch (error) {
    if (status) status.textContent = error.message || 'Ошибка соединения. Попробуйте ещё раз.';
    if (button) button.disabled = false;
  }
});


// Small pointer-driven interactions for desktop; these remain inert on touch and
// whenever either accessibility motion preference asks us to stop.
const pointerFine = matchMedia('(hover: hover) and (pointer: fine)');
if (pointerFine.matches) {
  const tiltTargets = document.querySelectorAll('main .card:not(.feed-card), main .overview-card, main .quick > a');
  for (const target of tiltTargets) {
    target.addEventListener('pointermove', event => {
      if (!motionEnabled()) return;
      const box = target.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - .5;
      const y = (event.clientY - box.top) / box.height - .5;
      target.style.setProperty('--tilt-x', (-y * 3.2).toFixed(2) + 'deg');
      target.style.setProperty('--tilt-y', (x * 3.2).toFixed(2) + 'deg');
      target.classList.add('site-tilt-active');
    });
    target.addEventListener('pointerleave', () => {
      target.classList.remove('site-tilt-active');
      target.style.removeProperty('--tilt-x');
      target.style.removeProperty('--tilt-y');
    });
  }

  const scene = document.querySelector('.hero');
  const illustration = scene?.querySelector('.neighborhood-art img');
  scene?.addEventListener('pointermove', event => {
    if (!illustration || !motionEnabled()) return;
    const box = scene.getBoundingClientRect();
    illustration.style.setProperty('--pointer-x', (((event.clientX - box.left) / box.width - .5) * 10).toFixed(1) + 'px');
    illustration.style.setProperty('--pointer-y', (((event.clientY - box.top) / box.height - .5) * 8).toFixed(1) + 'px');
  });
  scene?.addEventListener('pointerleave', () => {
    illustration?.style.setProperty('--pointer-x', '0px');
    illustration?.style.setProperty('--pointer-y', '0px');
  });
}

/* Publication sharing and photo viewer.
   Handlers are delegated to document: news and event pages are rendered by app.js after this file runs,
   so buttons and photos do not exist yet when the page loads. */
function setupPublicationTools(){
  const lightbox=document.createElement('div');lightbox.className='publication-lightbox';lightbox.setAttribute('role','dialog');lightbox.setAttribute('aria-label','Просмотр фотографии');
  const preview=document.createElement('img');preview.alt='';
  const close=document.createElement('button');close.type='button';close.setAttribute('aria-label','Закрыть');close.textContent='×';
  lightbox.append(preview,close);document.body.append(lightbox);
  const hide=()=>{lightbox.classList.remove('is-open');preview.removeAttribute('src')};
  close.addEventListener('click',hide);
  lightbox.addEventListener('click',event=>{if(event.target===lightbox)hide()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hide()});

  const copyText=async text=>{
    try{await navigator.clipboard.writeText(text);return true}
    catch{
      const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.cssText='position:fixed;opacity:0;top:0;left:0';
      document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();return ok;
    }
  };
  const flash=(button,text)=>{
    button.dataset.label??=button.textContent;
    button.textContent=text;
    setTimeout(()=>{button.textContent=button.dataset.label},2200);
  };

  document.addEventListener('click',async event=>{
    const copyButton=event.target.closest?.('[data-copy-link]');
    if(copyButton){
      const input=copyButton.parentElement.querySelector('.share-input');
      if(input){input.select();flash(copyButton,await copyText(input.value)?'Скопировано ✓':'Скопируйте ссылку вручную')}
      return;
    }
    const shareButton=event.target.closest?.('[data-share]');
    if(shareButton){
      const url=location.href,title=document.title;
      try{
        if(navigator.share){await navigator.share({title,url});return}
      }catch(error){if(error?.name==='AbortError')return}
      flash(shareButton,await copyText(url)?'Ссылка скопирована ✓':'Скопируйте ссылку из адресной строки');
      return;
    }
    const tile=event.target.closest?.('.media-tile');
    if(tile){
      event.preventDefault();
      const image=tile.querySelector('img');
      if(!image)return;
      preview.src=image.currentSrc||image.src;preview.alt=image.alt;
      lightbox.classList.add('is-open');close.focus();
    }
  });
}
setupPublicationTools();
