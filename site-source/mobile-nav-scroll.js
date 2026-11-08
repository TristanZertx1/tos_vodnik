/* Phone only: the section menu folds away while the page scrolls down and returns on scroll up or at the top. */
(function () {
  var root = document.documentElement, last = 0, queued = false;
  if (!window.matchMedia || !window.matchMedia('(max-width: 760px)').matches) return;
  function update() {
    queued = false;
    var y = window.scrollY || 0, nav = document.getElementById('nav');
    if (nav && nav.classList.contains('open')) { root.classList.remove('nav-away'); last = y; return; }
    var d = y - last;
    if (y < 80) root.classList.remove('nav-away');
    else if (d > 6) root.classList.add('nav-away');
    else if (d < -6) root.classList.remove('nav-away');
    last = y;
  }
  window.addEventListener('scroll', function () {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }, { passive: true });
})();
