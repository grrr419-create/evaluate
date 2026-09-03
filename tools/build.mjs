import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),files=['index.html','admin.html','app.js','cloud-api.js','statistics-excel.js','style.css','config.json','login-reference.jpg','favicon.svg','.nojekyll'];
const config=JSON.parse(await readFile(new URL('public/config.json',root),'utf8'));
if(!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/evaluate$/.test(config.apiUrl))throw new Error('Set public/config.json to the deployed evaluate function URL before publishing.');
let frozen;try{frozen=JSON.parse(await readFile(new URL('.private/frozen-data.json',root),'utf8'));}catch{}
await mkdir(new URL('docs/',root),{recursive:true});
for(const file of files){
 const path=new URL('public/'+file,root),raw=await readFile(path);
 if(/\.(?:js|json|html|css)$/.test(file)){
  const text=raw.toString('utf8');
  if(/sb_secret_|SUPABASE_SERVICE_ROLE_KEY|"people"\s*:|\.private\//.test(text))throw new Error('Private data found in public output: '+file);
  if(frozen?.people?.some(p=>p.name&&text.includes(p.name)))throw new Error('Participant name found in public output: '+file);
 }
 await copyFile(path,new URL('docs/'+file,root));
}
await writeFile(new URL('docs/robots.txt',root),'User-agent: *\nDisallow: /\n');
console.log('Built docs/ for GitHub Pages. Private roster, secrets and local data are excluded.');
