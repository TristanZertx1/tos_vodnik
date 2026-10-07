import { handleCMS, readPublic, ensureAnalyticsTable } from './lib/cms';
import { ensureResearchMaterials } from './lib/researched-content';
import { createEventRegistration } from './lib/event-registration';

interface Env {
  DB: D1Database;
  CMS_ADMIN_HASH?: string;
  CMS_ALLOWED_ORIGIN?: string;
}

const trackedPages = new Set([
  '/', '/o-tos', '/novosti', '/meropriyatiya', '/proekty', '/dokumenty', '/kontakty',
]);

function allowedOrigin(env: Env) {
  const value = env.CMS_ALLOWED_ORIGIN?.trim();
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.origin === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function visit(request: Request, env: Env) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if ((origin !== requestOrigin && origin !== allowedOrigin(env)) ||
      !request.headers.get('content-type')?.startsWith('application/json')) {
    return json({ error: 'Неверный запрос.' }, 400);
  }

  try {
    const input = await request.json() as { path?: unknown };
    if (typeof input.path !== 'string' || input.path.length > 180) return json({ error: 'Неверная страница.' }, 400);
    const path = input.path.split('?')[0].replace(/\/$/, '') || '/';
    if (!trackedPages.has(path)) {
      const match = /^\/novosti\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path);
      if (!match) return json({ error: 'Страница не учитывается.' }, 400);
      const article = await env.DB.prepare("SELECT id FROM cms_records WHERE kind='news' AND published=1 AND json_extract(data,'$.slug')=?").bind(match[1]).first();
      if (!article) return json({ error: 'Страница не найдена.' }, 404);
    }
    await ensureAnalyticsTable(env.DB);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yekaterinburg' }).format(new Date());
    await env.DB.prepare('INSERT INTO cms_page_views (day,path,views) VALUES (?,?,1) ON CONFLICT(day,path) DO UPDATE SET views=views+1').bind(day, path).run();
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return json({ error: 'Не удалось сохранить посещение.' }, 503);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!env.DB) return json({ error: 'База данных временно недоступна.' }, 503);

    try {
      if (pathname === '/healthz' && request.method === 'GET') return json({ ok: true });
      if ((pathname === '/content.json' || pathname === '/api/public/content') && request.method === 'GET') {
        await ensureResearchMaterials(env.DB);
        return json(await readPublic(env.DB));
      }
      const registration = /^\/api\/public\/events\/([a-z0-9-]{12,40})\/register$/i.exec(pathname);
      if (registration && request.method === 'POST') {
        return await createEventRegistration(request, env.DB, registration[1], allowedOrigin(env));
      }
      if (pathname === '/api/visit' && request.method === 'POST') return visit(request, env);
      if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) {
        await ensureResearchMaterials(env.DB);
        return handleCMS(request, env.DB, env.CMS_ADMIN_HASH, allowedOrigin(env));
      }
      return json({ error: 'Страница не найдена.' }, 404);
    } catch {
      return json({ error: 'Сервис временно недоступен. Повторите попытку позже.' }, 503);
    }
  },
};
