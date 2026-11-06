// Runs before the first paint: applies the saved theme and motion preference.
(function () {
  var root = document.documentElement;
  var theme = 'dark';
  try {
    var saved = localStorage.getItem('vodniki-theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
    if (localStorage.getItem('vodniki-motion') === 'reduced') root.classList.add('motion-reduced');
  } catch (e) { /* storage blocked: keep defaults */ }
  root.dataset.theme = theme;
})();
