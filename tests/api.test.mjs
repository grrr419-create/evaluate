import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createApi } from '../public/api.js';

test('browser token survives logout and sessions; blocked storage does not bypass participation limits', async () => {
  const saved = new Map(),
    requests = [];
  let blocked = false;
  const storage = {
    getItem: (key) => saved.get(key) || null,
    setItem: (key, value) => {
      if (blocked) throw Error('blocked');
      saved.set(key, value);
    },
    removeItem: (key) => saved.delete(key),
  };
  async function client() {
    const api = createApi({
      crypto: webcrypto,
      location: { hostname: 'example.github.io' },
      localStorage: storage,
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      async fetch(url, options) {
        if (url === './config.json')
          return Response.json({ apiUrl: 'https://project.supabase.co/functions/v1/evaluate' });
        requests.push(JSON.parse(options.body));
        return Response.json({ session: 'fixture-session', ok: true });
      },
    });
    await api.init('evaluate');
    return api;
  }
  const first = await client();
  await first.request('/api/evaluate/login');
  await first.request('/api/evaluate/logout');
  const second = await client();
  await second.request('/api/evaluate/login');
  assert.deepEqual(Object.keys(requests[0].body), ['device']);
  assert.match(requests[0].body.device, /^[0-9a-f]{64}$/);
  assert.equal(requests[0].body.device, requests[2].body.device);
  saved.clear();
  blocked = true;
  const third = await client();
  await assert.rejects(third.request('/api/evaluate/login'), /저장/);
  assert.equal(requests.length, 3);
});
