import { readFile } from 'node:fs/promises';

export const root = new URL('../', import.meta.url);
export const assets = [
  'app.js',
  'api.js',
  'views.js',
  'confirmation.js',
  'statistics-excel.js',
  'style.css',
  'config.json',
  'login-reference.jpg',
  'favicon.svg',
  '.nojekyll',
];
export const pages = { 'index.html': 'evaluate', 'admin.html': 'admin' };

export async function page(role, version) {
  let html = await readFile(new URL('public/index.html', root), 'utf8');
  html = html.replace('data-role="evaluate"', `data-role="${role}"`);
  if (version)
    html = html
      .replace('./app.js', `./app.js?v=${version}`)
      .replace('./style.css', `./style.css?v=${version}`);
  return html;
}

export function versionImports(source, version) {
  return source.replace(
    /(from\s+|import\()(['"])(\.\/[a-z-]+\.js)\2/g,
    (_, prefix, quote, file) => `${prefix}${quote}${file}?v=${version}${quote}`,
  );
}
