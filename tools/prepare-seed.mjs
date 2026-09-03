import { readFile, writeFile } from 'node:fs/promises';
import { root } from './assets.mjs';
import { readNotice, quoteSql } from './notice.mjs';

const input = JSON.parse(await readFile(new URL('.private/frozen-data.json', root), 'utf8'));
const admin = JSON.parse(await readFile(new URL('.private/관리자설정.json', root), 'utf8'));
const source = {
  mode: 'device',
  revision: input.revision,
  survey_version: input.survey_version,
  questions: input.questions,
  ...(await readNotice()),
};
await writeFile(
  new URL('.private/install.sql', root),
  `-- PRIVATE: contains administrator credentials. Never publish.\nbegin;\nselect evaluate_private.install(${quoteSql(JSON.stringify(source))}::jsonb,${quoteSql(admin.id)},${quoteSql(admin.password)});\ncommit;\n`,
);
console.log('Private installation SQL prepared. Do not publish .private/.');
