(() => {
  const toggle = document.querySelector('#vision');
  if (!toggle) return;
  const storageKey = 'vodniki-vision';
  // Native checkbox + CSS handle the mode; storage is an optional enhancement.
  try { toggle.checked = localStorage.getItem(storageKey) === '1'; } catch {}
  toggle.addEventListener('change', () => {
    try { localStorage.setItem(storageKey, toggle.checked ? '1' : '0'); } catch {}
  });
})();
