import { readFile } from 'node:fs/promises';

export const root = new URL('../', import.meta.url);
export const assets = [
  'app.js',
  'api.js',
  'views.js',
  'assessment-rules.js',
  'confirmation.js',
  'statistics-excel.js',
  'style.css',
  'config.json',
  'login-reference.jpg',
  'admin-og.png',
  'favicon.svg',
  '.nojekyll',
];
export const pages = { 'index.html': 'evaluate', 'admin.html': 'admin' };

const pageMetadata = {
  evaluate: {
    PAGE_TITLE: '업무환경 심리평가 | HANSHIN',
    OG_TITLE: '업무환경 심리평가',
    META_DESCRIPTION: '무기명으로 진행되는 업무환경 심리평가입니다.',
    PAGE_URL: 'https://grrr419-create.github.io/evaluate/',
    OG_IMAGE: 'https://grrr419-create.github.io/evaluate/login-reference.jpg',
    OG_IMAGE_ALT: '업무환경 심리평가 참여 페이지',
  },
  admin: {
    PAGE_TITLE: '업무환경 심리평가 관리자 | HANSHIN',
    OG_TITLE: '업무환경 심리평가 관리자',
    META_DESCRIPTION: '참여 현황과 평가 결과를 확인하는 관리자 페이지입니다.',
    PAGE_URL: 'https://grrr419-create.github.io/evaluate/admin.html',
    OG_IMAGE: 'https://grrr419-create.github.io/evaluate/admin-og.png',
    OG_IMAGE_ALT: '업무환경 심리평가 관리자 페이지',
  },
};

export async function page(role, version) {
  let html = await readFile(new URL('public/index.html', root), 'utf8');
  html = html.replace('data-role="evaluate"', `data-role="${role}"`);
  for (const [key, value] of Object.entries(pageMetadata[role])) html = html.replaceAll(`{{${key}}}`, value);
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
