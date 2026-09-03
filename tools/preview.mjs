// Isolated fictional data. No connection to the production database.
import http from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { database, call, handler } from '../tests/helpers.mjs';
import { root, assets, pages, page } from './assets.mjs';

const db = await database();
const createHandler = await handler();
const types = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
};
const allowed = new Set(assets);
const runtime = new URL('.private/preview.json', root);
let origin, handle;
const server = http.createServer(async (request, response) => {
  try {
    const name = new URL(request.url, origin).pathname.slice(1) || 'index.html';
    const send = (type, content) => {
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(content);
    };
    if (name === 'config.json')
      return send('application/json', JSON.stringify({ apiUrl: origin + '/api-gateway' }));
    if (name === 'api-gateway') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = await handle(
        new Request(origin + '/api-gateway', {
          method: request.method,
          headers: request.headers,
          body: request.method === 'POST' ? Buffer.concat(chunks) : undefined,
        }),
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    if (Object.hasOwn(pages, name)) return send(types.html, await page(pages[name]));
    if (!allowed.has(name)) {
      response.writeHead(404);
      response.end();
      return;
    }
    send(
      types[name.split('.').pop()] || 'application/octet-stream',
      await readFile(new URL('public/' + name, root)),
    );
  } catch {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Preview server error' }));
  }
});
server.listen(0, '127.0.0.1', async () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  handle = createHandler(
    {
      ALLOWED_ORIGINS: origin,
      SUPABASE_URL: 'https://preview.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'local-only',
    },
    async (_url, options) => {
      const input = JSON.parse(options.body);
      return Response.json(await call(db, input.p_route, input.p_body, input.p_session, input.p_client));
    },
  );
  await mkdir(new URL('.private/', root), { recursive: true });
  await writeFile(runtime, JSON.stringify({ pid: process.pid, url: origin }));
  console.log(origin);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () =>
    server.close(async () => {
      await db.close();
      await unlink(runtime).catch(() => {});
      process.exit();
    }),
  );
