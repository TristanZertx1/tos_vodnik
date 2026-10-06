import { env } from 'cloudflare:workers';
import { handleCMS } from '../../../../lib/cms';
import { ensureResearchMaterials } from '../../../../lib/researched-content';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  if (!env.DB) return Response.json({ error:'База данных панели временно недоступна.' },{status:503,headers:{'Cache-Control':'no-store'}});
  try { await ensureResearchMaterials(env.DB); }
  catch { return Response.json({error:'Не удалось подключить материалы. Повторите позже.'},{status:503}); }
  return handleCMS(request, env.DB, env.CMS_ADMIN_HASH);
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
