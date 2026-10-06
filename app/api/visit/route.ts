import { env } from 'cloudflare:workers';
import { ensureAnalyticsTable } from '../../../lib/cms';

export const dynamic = 'force-dynamic';

const fixedPages = new Set(['/', '/o-tos', '/novosti', '/meropriyatiya', '/proekty', '/dokumenty', '/kontakty']);

export async function POST(request: Request) {
  if (!env.DB) return Response.json({ error: 'Статистика временно недоступна.' }, { status: 503 });
  const url = new URL(request.url);
  if (request.headers.get('origin') !== url.origin || !request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ error: 'Неверный запрос.' }, { status: 400 });
  }
  try {
    const input = await request.json() as { path?: unknown };
    if (typeof input.path !== 'string' || input.path.length > 180) return Response.json({ error: 'Неверная страница.' }, { status: 400 });
    const path = input.path.split('?')[0].replace(/\/$/, '') || '/';
    if (!fixedPages.has(path)) {
      const match = /^\/novosti\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path);
      if (!match) return Response.json({ error: 'Страница не учитывается.' }, { status: 400 });
      const article = await env.DB.prepare("SELECT id FROM cms_records WHERE kind='news' AND published=1 AND json_extract(data,'$.slug')=?").bind(match[1]).first();
      if (!article) return Response.json({ error: 'Страница не найдена.' }, { status: 404 });
    }
    await ensureAnalyticsTable(env.DB);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yekaterinburg' }).format(new Date());
    await env.DB.prepare('INSERT INTO cms_page_views (day,path,views) VALUES (?,?,1) ON CONFLICT(day,path) DO UPDATE SET views=views+1').bind(day, path).run();
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Не удалось сохранить посещение.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
