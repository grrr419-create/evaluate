import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, assets, pages, page, versionImports } from './assets.mjs';

export async function build(destination = new URL('docs/', root)) {
  const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const config = JSON.parse(await readFile(new URL('public/config.json', root), 'utf8'));
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/evaluate$/.test(config.apiUrl))
    throw new Error('Set public/config.json to the deployed evaluate function URL.');
  await mkdir(destination, { recursive: true });
  const output = new Map();
  for (const name of assets) {
    let content = await readFile(new URL('public/' + name, root));
    if (/\.(js|css|json)$/.test(name)) {
      let text = content.toString('utf8');
      if (/sb_secret_|SUPABASE_SERVICE_ROLE_KEY|"people"\s*:|\.private\//.test(text))
        throw new Error('Private data found in public output: ' + name);
      if (name.endsWith('.js')) text = versionImports(text, version);
      content = text;
    }
    output.set(name, content);
  }
  for (const [name, role] of Object.entries(pages)) output.set(name, await page(role, version));
  output.set('robots.txt', 'User-agent: *\nDisallow: /\n');
  for (const [name, content] of output) await writeFile(new URL(name, destination), content);
  // Only unlink obsolete files directly inside the designated build directory.
  for (const entry of await readdir(destination, { withFileTypes: true })) {
    if (entry.isFile() && !output.has(entry.name)) await unlink(new URL(entry.name, destination));
  }
  return { version, files: [...output.keys()] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  console.log(await build());
