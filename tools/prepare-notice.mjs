import { readFile, writeFile } from 'node:fs/promises';
import { root } from './assets.mjs';
import { readNotice, quoteSql } from './notice.mjs';

const content = await readNotice();
const sourceFile = new URL('.private/frozen-data.json', root);
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
await writeFile(sourceFile, JSON.stringify({ ...source, ...content }, null, 2) + '\n');
const sql = `-- Update only the notice. Does not reset answers, sessions or participation.\nbegin;\nupdate evaluate_private.settings set source=source||${quoteSql(JSON.stringify(content))}::jsonb where singleton;\ncommit;\n`;
await writeFile(new URL('.private/update-notice.sql', root), sql);
console.log(
  'Prepared .private/update-notice.sql from the root 안내멘트.txt. Apply this SQL to publish the notice.',
);
