// Runs before the first paint: the site is always light; applies the saved motion preference.
(function () {
  var root = document.documentElement;
  try {
    if (localStorage.getItem('vodniki-motion') === 'reduced') root.classList.add('motion-reduced');
  } catch (e) { /* storage blocked: keep defaults */ }
  root.dataset.theme = 'light';
})();
