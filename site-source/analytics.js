(() => {
  if (location.pathname.startsWith('/admin') || !window.vodnikiApiFetch) return;
  const path = location.pathname.replace(/\/$/, '') || '/';
  const key = `vodniki-visit:${path}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {}
  window.vodnikiApiFetch('/api/visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    keepalive: true,
  }).catch(() => {});
})();
