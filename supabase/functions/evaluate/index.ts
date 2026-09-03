// Custom employee/admin authentication is handled by the database API.
// Never log request bodies, passwords, session tokens, or individual answers.
const ROUTES = new Set([
  '/api/bootstrap','/api/evaluate/login','/api/evaluate/logout','/api/evaluate/session',
  '/api/evaluate/acknowledge','/api/evaluate/submit','/api/admin/login','/api/admin/logout',
  '/api/admin/dashboard','/api/admin/export','/api/admin/reset-preview','/api/admin/reset',
]);
export function createHandler(env, transport = fetch) {
  const origins = new Set((env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean));
  return async function handle(request) {
    const origin = request.headers.get('Origin') || '';
    const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
    const reply = (status, data) => new Response(JSON.stringify(data), {status, headers});
    if (!origins.has(origin)) return reply(403, {error:'허용된 평가 페이지에서 접속해 주세요.'});
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'content-type, apikey';
    headers['Access-Control-Max-Age'] = '600';
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
    if (request.method !== 'POST') return reply(405, {error:'지원하지 않는 요청입니다.'});
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply(415, {error:'요청 형식을 확인해 주세요.'});
    if (Number(request.headers.get('Content-Length')) > 65536) return reply(413, {error:'요청이 너무 큽니다.'});
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return reply(503,{error:'평가 서버 연결을 준비 중입니다.'});
    let input;
    try {
      const reader=request.body?.getReader(); const chunks=[]; let size=0;
      if (!reader) return reply(400,{error:'요청 내용을 확인해 주세요.'});
      for (;;) {
        const {done,value}=await reader.read(); if (done) break;
        size+=value.byteLength;
        if (size>65536) {await reader.cancel();return reply(413,{error:'요청이 너무 큽니다.'});}
        chunks.push(value);
      }
      const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}
      input=JSON.parse(new TextDecoder().decode(raw));
    } catch {return reply(400,{error:'요청 내용을 확인해 주세요.'});}
    if (!input || typeof input !== 'object' || !ROUTES.has(input.route) || typeof input.session !== 'string' || input.session.length>128 || !input.body || typeof input.body !== 'object' || Array.isArray(input.body)) return reply(400,{error:'요청 내용을 확인해 주세요.'});
    try {
      const address=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const clientHash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(address));
      const client=Array.from(new Uint8Array(clientHash),x=>x.toString(16).padStart(2,'0')).join('');
      const upstream=await transport(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/evaluate_api',{
        method:'POST',headers:{'Content-Type':'application/json','apikey':env.SUPABASE_SERVICE_ROLE_KEY,'Authorization':'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY},
        body:JSON.stringify({p_route:input.route,p_body:input.body,p_session:input.session,p_client:client}),signal:AbortSignal.timeout(20000),
      });
      if (!upstream.ok) return reply(503,{error:'결과 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'});
      const result=await upstream.json();
      if (!Number.isInteger(result.status) || result.status<200 || result.status>599 || result.data===undefined) return reply(503,{error:'평가 서버 응답을 확인할 수 없습니다.'});
      return reply(result.status,result.data);
    } catch {return reply(503,{error:'서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'});}
  };
}
if (typeof Deno !== 'undefined') {
  Deno.serve(createHandler({
    ALLOWED_ORIGINS:Deno.env.get('ALLOWED_ORIGINS'),
    SUPABASE_URL:Deno.env.get('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  }));
}
