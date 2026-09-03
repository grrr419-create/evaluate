import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const quoteSql = (value) => "'" + String(value).replaceAll("'", "''") + "'";
export async function readNotice() {
  const notice = (await readFile(new URL('../../안내멘트.txt', import.meta.url), 'utf8'))
    .replace(/\r\n/g, '\n')
    .trim();
  return { notice, notice_version: createHash('sha256').update(notice).digest('hex') };
}
