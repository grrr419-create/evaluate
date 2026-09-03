import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile,readdir} from 'node:fs/promises';
import {fixture,fixtureAdmin} from './fixtures.mjs';
export async function database({legacy=false}={}){
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const migrationRoot=new URL('../supabase/migrations/',import.meta.url);
 for(const name of (await readdir(migrationRoot)).filter(x=>x.endsWith('.sql')).sort()){
  if(legacy&&name!=='202609030001_evaluate.sql')continue;
  await db.exec(await readFile(new URL(name,migrationRoot),'utf8'));
 }
 await db.query('select evaluate_private.install($1::jsonb,$2,$3)',[JSON.stringify(fixture),fixtureAdmin.id,fixtureAdmin.password]);
 return db;
}
export async function call(db,route,body={},session='',client='fixture-client'){
 const result=await db.query('select public.evaluate_api($1,$2::jsonb,$3,$4) as result',[route,JSON.stringify(body),session,client]);return result.rows[0].result;
}
export async function handler(){
 const text=await readFile(new URL('../supabase/functions/evaluate/index.ts',import.meta.url),'utf8');return (await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'))).createHandler;
}
