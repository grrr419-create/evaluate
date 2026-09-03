import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),input=JSON.parse(await readFile(new URL('.private/frozen-data.json',root),'utf8')),admin=JSON.parse(await readFile(new URL('.private/관리자설정.json',root),'utf8'));
const source={mode:'device',revision:input.revision,survey_version:input.survey_version,notice:input.notice,notice_version:input.notice_version,questions:input.questions};
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
await writeFile(new URL('.private/install.sql',root),'-- PRIVATE: contains administrator credentials. Never publish.\nbegin;\nselect evaluate_private.install('+quote(JSON.stringify(source))+'::jsonb,'+quote(admin.id)+','+quote(admin.password)+');\ncommit;\n');
console.log('Private installation SQL prepared. Do not commit .private/.');
