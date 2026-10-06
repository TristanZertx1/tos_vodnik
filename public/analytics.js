(() => {
  if (location.pathname.startsWith('/admin') || !navigator.sendBeacon && !fetch) return;
  const path = location.pathname.replace(/\/$/, '') || '/';
  const key = `vodniki-visit:${path}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {}
  fetch('/api/visit', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    keepalive: true,
  }).catch(() => {});
})();
