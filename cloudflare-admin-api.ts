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
  if ((origin !== requestOrigin && !allowedClientOrigins(env).includes(origin || '')) ||
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

function allowedClientOrigins(env: Env) {
  return [
    allowedOrigin(env),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].filter((origin): origin is string => Boolean(origin));
}

function isAllowedClientOrigin(origin: string | null, env: Env) {
  return Boolean(origin && allowedClientOrigins(env).includes(origin));
}

function withCors(response: Response, request: Request, env: Env) {
  const origin = request.headers.get('origin');
  if (!isAllowedClientOrigin(origin, env)) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin!);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type, X-CSRF-Token');
  headers.set('Access-Control-Max-Age', '600');
  const vary = headers.get('Vary');
  headers.set('Vary', vary ? `${vary}, Origin` : 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const origin = request.headers.get('origin');
    if (request.method === 'OPTIONS') {
      if (!isAllowedClientOrigin(origin, env)) return json({ error: 'Запрос с этого сайта запрещён.' }, 403);
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    let response: Response;
    if (!env.DB) {
      response = json({ error: 'База данных временно недоступна.' }, 503);
    } else {
      try {
        if (pathname === '/healthz' && request.method === 'GET') {
          response = json({ ok: true });
        } else if ((pathname === '/content.json' || pathname === '/api/public/content') && request.method === 'GET') {
          await ensureResearchMaterials(env.DB);
          response = json(await readPublic(env.DB));
        } else {
          const registration = /^\/api\/public\/events\/([a-z0-9-]{12,40})\/register$/i.exec(pathname);
          if (registration && request.method === 'POST') {
            response = await createEventRegistration(request, env.DB, registration[1], allowedClientOrigins(env));
          } else if (pathname === '/api/visit' && request.method === 'POST') {
            response = await visit(request, env);
          } else if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) {
            await ensureResearchMaterials(env.DB);
            response = await handleCMS(request, env.DB, env.CMS_ADMIN_HASH, allowedClientOrigins(env));
          } else {
            response = json({ error: 'Страница не найдена.' }, 404);
          }
        }
      } catch {
        response = json({ error: 'Сервис временно недоступен. Повторите попытку позже.' }, 503);
      }
    }
    return withCors(response, request, env);
  },
};
