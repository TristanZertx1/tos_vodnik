(() => {
  const toggle = document.querySelector('#vision');
  if (!toggle) return;
  const storageKey = 'vodniki-vision', root = document.documentElement;
  // Режим включается ещё в <head> (vision-init.js); здесь синхронизируем переключатель.
  try { toggle.checked = localStorage.getItem(storageKey) === '1'; } catch {}
  root.classList.toggle('vision', toggle.checked);
  toggle.addEventListener('change', () => {
    root.classList.toggle('vision', toggle.checked);
    try { localStorage.setItem(storageKey, toggle.checked ? '1' : '0'); } catch {}
  });
})();
