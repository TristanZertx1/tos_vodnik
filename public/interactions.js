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
const heroArt = document.querySelector('.neighborhood-art');
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
  document.body.style.setProperty('--pattern-offset', motionEnabled() ? -Math.min(scrollY * .11, 90) + 'px' : '0px');
  pending = false;
}
addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(updateScroll); } }, { passive: true });
addEventListener('resize', updateScroll);
updateScroll();
const stopMotion = () => { if (reducedMotion.matches || vision?.checked) { for (const animation of animated) animation.cancel(); animated.clear(); } updateScroll(); };
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
