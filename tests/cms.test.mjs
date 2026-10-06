import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleCMS, readPublic, validateRecord, validateLayout } from '../lib/cms.ts';
import { hashPassword } from '../lib/password.mjs';
import { ensureResearchMaterials } from '../lib/researched-content.ts';
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
  const db = {
    prepare(sql) {
      let values=[];
      return { bind(...args){values=args;return this}, async first(){return sqlite.prepare(sql).get(...values)||null}, async all(){return {results:sqlite.prepare(sql).all(...values)}}, async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}}} };
    },
    async batch(statements) { sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e} },
  };
  return db;
}
const origin='https://example.test';
function request(path,method='GET',body,session={},extra={}) {
  const headers={...(method==='GET'?{}:{origin,'content-type':'application/json'}),...(session.cookie?{cookie:session.cookie}:{}),...(session.csrf?{'x-csrf-token':session.csrf}:{}),...extra};
  return new Request(origin+'/api/admin/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
async function login(db,hash,username,password) {
  const response=await handleCMS(request('login','POST',{username,password}),db,hash);
  assert.equal(response.status,200,await response.clone().text());
  const data=await response.json();return {...data,cookie:response.headers.get('set-cookie').split(';')[0]};
}
test('Server authentication, moderation rights, drafts, edits and revocation',async()=>{
  const db=database(),hash=await hashPassword('test-password');
  assert.equal((await handleCMS(new Request(origin+'/api/admin/me'),db,hash)).status,401);
  assert.equal((await handleCMS(request('login','POST',{username:'admin',password:'wrong'}),db,hash)).status,401);
  const admin=await login(db,hash,'admin','test-password');
  assert.match(admin.cookie,/^__Host-vodniki-cms=/);
  assert.equal((await handleCMS(request('users','POST',{username:'mod',password:'moderator-password'},admin,{'x-csrf-token':'wrong'}),db,hash)).status,403);
  assert.equal((await handleCMS(request('users','POST',{username:'mod',password:'moderator-password'},admin,{origin:'https://attacker.test'}),db,hash)).status,403);
  assert.equal((await handleCMS(request('users','POST',{username:'mod',password:'moderator-password',role:'admin'},admin),db,hash)).status,201);
  const moderator=await login(db,hash,'mod','moderator-password');assert.equal(moderator.user.role,'moderator');
  assert.equal((await handleCMS(request('users','GET',undefined,moderator),db,hash)).status,403);
  assert.equal((await handleCMS(request('records','POST',{kind:'contacts',data:{}},moderator),db,hash)).status,403);
  const news={title:'Проверочный материал',slug:'test-news',date:'2026-10-05',category:'Объявления',description:'Материал для проверки, не публикуется на реальном сайте.'};
  let response=await handleCMS(request('records','POST',{kind:'news',data:news,published:false},moderator),db,hash);assert.equal(response.status,201);const {id}=await response.json();
  assert.equal((await readPublic(db)).news.length,0);
  response=await handleCMS(request('records/'+id,'PUT',{kind:'news',data:news,published:true,revision:1},moderator),db,hash);assert.equal(response.status,200);
  assert.equal((await readPublic(db)).news[0].slug,'test-news');
  assert.equal((await handleCMS(request('records/'+id,'PUT',{kind:'news',data:news,published:true,revision:1},moderator),db,hash)).status,409);
  assert.equal((await handleCMS(request('records','POST',{kind:'news',data:news},moderator),db,hash)).status,409);
  assert.equal((await handleCMS(request('me','GET',undefined,moderator),db,hash)).status,200);
  const users=await (await handleCMS(request('users','GET',undefined,admin),db,hash)).json();const mod=users.find(u=>u.username==='mod');
  assert.ok(users.every(u=>!('password'in u)));
  assert.equal((await handleCMS(request('users/'+mod.id,'PATCH',{enabled:false},admin),db,hash)).status,200);
  assert.equal((await handleCMS(request('me','GET',undefined,moderator),db,hash)).status,401);
  assert.equal((await handleCMS(request('login','POST',{username:'mod',password:'moderator-password'}),db,hash)).status,401);
  await handleCMS(request('users/'+mod.id,'PATCH',{enabled:true,password:'replacement-password'},admin),db,hash);
  const restored=await login(db,hash,'mod','replacement-password');
  assert.equal((await handleCMS(request('records/'+id,'DELETE',undefined,restored),db,hash)).status,200);
  assert.equal((await readPublic(db)).news.length,0);
  assert.equal((await handleCMS(request('users/admin','DELETE',undefined,admin),db,hash)).status,400);
  await handleCMS(request('users/'+mod.id,'DELETE',undefined,admin),db,hash);
  assert.equal((await handleCMS(request('me','GET',undefined,restored),db,hash)).status,401);
  assert.equal((await handleCMS(request('password','POST',{currentPassword:'test-password',password:'new-admin-password'},admin),db,hash)).status,200);
  assert.equal((await handleCMS(request('me','GET',undefined,admin),db,hash)).status,401);
  await login(db,hash,'admin','new-admin-password');
});
test('Research import preserves editor changes, existing contacts and deletions',async()=>{
  const db=database();
  await db.prepare('INSERT INTO cms_records (id,kind,data,published,revision,updated_at,updated_by) VALUES (?,?,?,?,1,?,?)').bind('contacts','contacts',JSON.stringify({phone:'Confirmed by editor'}),1,1,'admin').run();
  await ensureResearchMaterials(db);
  let content=await readPublic(db);assert.equal(content.news.length,2);assert.equal(content.projects.length,1);assert.equal(content.contacts.phone,'Confirmed by editor');assert.equal(content.events.length,0);
  await db.prepare('DELETE FROM cms_records WHERE id=?').bind('sources-ostrov-2018').run();
  await db.prepare('UPDATE cms_records SET published=0 WHERE id=?').bind('sources-istochnik').run();
  await ensureResearchMaterials(db);
  content=await readPublic(db);assert.equal(content.news.length,1);assert.equal(content.projects.length,0);
});
test('Invalid materials and rate limits',async()=>{
  assert.throws(()=>validateRecord('documents',{title:'X',date:'2026-02-30',format:'PDF',size:'1 KB',url:'https://example.test/a.pdf'}));
  assert.throws(()=>validateRecord('projects',{title:'X',status:'X',description:'X',participation:'X',image:'javascript:alert(1)',imageAlt:'X',imagePermission:true}));
  assert.throws(()=>validateRecord('projects',{title:'X',status:'X',description:'X',participation:'X',image:'https://example.test/a.jpg',imageAlt:'X'}));
  const db=database(),hash=await hashPassword('test-password');
  for(let i=0;i<10;i++)assert.equal((await handleCMS(request('login','POST',{username:'admin',password:'wrong'}),db,hash)).status,401);
  assert.equal((await handleCMS(request('login','POST',{username:'admin',password:'test-password'}),db,hash)).status,429);
});
test('Site builder validates themes, per-page modules and custom text sections',()=>{
  const baseline={homeOrder:['hero','quick','overview','news','events','projects','join'],homeHidden:[],homeCustom:[],texts:{},theme:{primary:'#146e62',font:'Georgia',width:'wide',scale:'large',spacing:'relaxed',radius:'round',backgroundMode:'pattern'},modules:{'/o-tos/':{order:['about-heading','custom-abcdef12','about-nav','about-intro','about-directions','about-chairperson','about-clubs','about-participate','about-activity-2025','about-activity-2024','about-faq'],hidden:[]}},pageCustom:{'/o-tos/':[{id:'custom-abcdef12',title:'Новый раздел',body:'Текст раздела'}]}};
  const layout=validateLayout(baseline);
  assert.equal(layout.theme.font,'Georgia');
  assert.equal(layout.theme.primary,'#146e62');
  assert.equal(layout.modules['/o-tos/'].order[1],'custom-abcdef12');
  assert.equal(layout.pageCustom['/o-tos/'][0].title,'Новый раздел');
  assert.throws(()=>validateLayout({...baseline,theme:{...baseline.theme,primary:'url(javascript:alert(1))'}}));
  assert.throws(()=>validateLayout({...baseline,modules:{'/o-tos/':{order:['<script>'],hidden:[]}}}));
  assert.throws(()=>validateLayout({...baseline,pageCustom:{'/o-tos/':[{...baseline.pageCustom['/o-tos/'][0],body:'x'.repeat(2001)}]}}));
});
