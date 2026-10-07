function escape(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export function applyFooterSettings(html: string, layout: any) {
  const footer = layout?.footer || {};
  const phone = String(footer.phone ?? '').replace(/\D/g, '');
  const email = String(footer.email ?? '').trim();
  html = html.replace(/<span\b([^>]*\bdata-footer-field="([a-zA-Z0-9]+)"[^>]*)>[\s\S]*?<\/span>/g, (match, attrs, key) =>
    Object.hasOwn(footer, key) ? '<span' + attrs + '>' + escape(String(footer[key])).replace(/\r?\n/g, '<br>') + '</span>' : match,
  );
  if (Object.hasOwn(footer, 'phone')) {
    html = html.replace(/(<a\b[^>]*\bdata-footer-link="phone"[^>]*\bhref=")[^"]*(")/, (_match, prefix, suffix) => prefix + 'tel:' + (phone ? '+' + escape(phone) : '') + suffix);
  }
  if (Object.hasOwn(footer, 'email')) {
    html = html.replace(/(<a\b[^>]*\bdata-footer-link="email"[^>]*\bhref=")[^"]*(")/, (_match, prefix, suffix) => prefix + 'mailto:' + escape(email) + suffix);
  }
  return html;
}
