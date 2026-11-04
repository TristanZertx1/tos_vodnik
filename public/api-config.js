(() => {
  // REG.ru deployment: same-origin API avoids CORS and Cloudflare dependency.
  const apiBase = new URL('/api/', window.location.origin);
  window.vodnikiApiFetch = (path, options = {}) => {
    if (typeof path !== 'string' || !path.startsWith('/api/')) return Promise.reject(new TypeError('Недопустимый адрес API.'));
    const url = new URL(path, apiBase);
    if (url.origin !== apiBase.origin) return Promise.reject(new TypeError('Запрос за пределы API запрещён.'));
    return fetch(url, { ...options, credentials: 'include' });
  };
})();
