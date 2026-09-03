/* Minimal XLSX writer: fixed XML schema, inline strings, numeric counts, no formulas/macros. */
'use strict';
const StatisticsExcel=(()=>{
 const encoder=new TextEncoder();
 const escape=v=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
 function zip(files){
  const local=[],central=[];let offset=0;
  for(const [path,text] of files){
   const name=encoder.encode(path),data=encoder.encode(text),crc=crc32(data);
   const head=new Uint8Array(30+name.length),v=new DataView(head.buffer);
   v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);head.set(name,30);
   const entry=new Uint8Array(46+name.length),c=new DataView(entry.buffer);
   c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);entry.set(name,46);
   local.push(head,data);central.push(entry);offset+=head.length+data.length;
  }
  const centralSize=central.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);
  v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
  const result=new Uint8Array(offset+centralSize+22);let at=0;for(const part of [...local,...central,end]){result.set(part,at);at+=part.length;}return result;
 }

 const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 const mainNamespace='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const relationshipNamespace='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const textWidth=value=>Array.from(String(value??'')).reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0);
 function sheet({title,subtitle='업무환경 심리평가 · 현재 평가 응답 통계',headers,rows,widths,percentColumns=[]}){
  const values=[[title],[subtitle],[],headers,...rows];
  const xml=values.map((row,index)=>{
   const height=index===0?34:index===1?Math.max(26,Math.ceil(textWidth(subtitle)/widths.reduce((a,b)=>a+b,0))*17+10):Math.max(index===3?28:36,...row.map((v,i)=>Math.ceil(textWidth(v)/Math.max(8,widths[i]-3))*17+10));
   return '<row r="'+(index+1)+'" ht="'+height+'" customHeight="1">'+row.map((value,column)=>{
    const ref=String.fromCharCode(65+column)+(index+1),style=index===0?1:index===3?2:typeof value==='number'&&percentColumns.includes(column)?4:3;
    return typeof value==='number'?'<c r="'+ref+'" s="'+style+'"><v>'+value+'</v></c>':'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+escape(value)+'</t></is></c>';
   }).join('')+'</row>';
  }).join('');
  const last=String.fromCharCode(64+headers.length);
  return declaration+'<worksheet xmlns="'+mainNamespace+'"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols><sheetData>'+xml+'</sheetData><mergeCells count="2"><mergeCell ref="A1:'+last+'1"/><mergeCell ref="A2:'+last+'2"/></mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>';
 }
 function create(dep){
  if(!Number.isInteger(dep?.completed)||dep.completed<1||!Array.isArray(dep.statistics)||!dep.statistics.length)throw new Error('제출된 평가가 없습니다.');
  if(!Array.isArray(dep.responses)||!Number.isInteger(dep.response_count)||dep.response_count<0||dep.responses.length!==dep.response_count||!Number.isInteger(dep.unavailable_response_count)||dep.unavailable_response_count<0||dep.response_count+dep.unavailable_response_count!==dep.completed)throw new Error('개별 응답 수를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.');
  const rows=[],responseCounts=dep.statistics.map(q=>Array(q.options.length).fill(0));
  const questionIds=new Set(dep.statistics.map(q=>q.id));
  if(questionIds.size!==dep.statistics.length)throw new Error('문항 정보 검증에 실패했습니다.');
  for(const entry of dep.responses){
   const response=entry.answers;
   if(!response||typeof response!=='object'||Array.isArray(response)||Object.keys(response).length!==questionIds.size||Object.keys(response).some(k=>!questionIds.has(k)))throw new Error('개별 답변 검증에 실패했습니다.');
   dep.statistics.forEach((q,i)=>{const choice=response[q.id];if(!Number.isInteger(choice)||choice<0||choice>=q.options.length)throw new Error('개별 답변 검증에 실패했습니다.');responseCounts[i][choice]++;});
  }
  dep.statistics.forEach((q,i)=>{
   if(q.options.length!==q.counts.length||q.counts.some(n=>!Number.isInteger(n)||n<0)||q.counts.reduce((a,b)=>a+b,0)!==dep.completed||responseCounts[i].some((n,j)=>n>q.counts[j]))throw new Error('응답 수 검증에 실패했습니다.');
   q.options.forEach((option,index)=>rows.push([dep.name,q.text,option,q.counts[index],dep.completed,q.counts[index]/dep.completed]));
  });
  const sheets=[
   {name:'평가 현황',title:'현재 평가 참여 현황',headers:['평가 이름','참여 완료(명)','집계 범위'],rows:[[dep.name,dep.completed,'마지막 초기화 이후 제출된 평가']],widths:[36,22,60]},
   {name:'문항별 통계',title:'문항별 응답 통계',headers:['평가 이름','문항','답변','응답 수(명)','참여 완료(명)','응답 비율'],rows,widths:[28,72,24,18,18,16],percentColumns:[5]},
   {name:'개별 응답 안내',title:'개별 응답 안내',subtitle:dep.name,headers:['구분','내용'],rows:[
    ['전체 제출 수',dep.completed],['개별 응답 시트 수',dep.response_count],['개별 답변 미보관 수',dep.unavailable_response_count],
    ['시트 구성','각 응답 시트에 한 참여자의 전체 답변을 표시합니다. 이름·사번·닉네임·IP·제출 시각은 포함하지 않으며 시트 번호는 제출 순서와 관계없습니다.'],
    ['취합 범위',dep.unavailable_response_count?'취합 통계에는 모든 제출이 포함됩니다. 개별 답변 보관 기능 도입 전 제출한 '+dep.unavailable_response_count+'건은 합계만 저장되어 있어 개인별 답변을 복원할 수 없습니다.':'취합 통계와 개별 응답 시트 모두 전체 제출을 포함합니다.']
   ],widths:[28,96]}
  ];
  dep.responses.forEach((response,i)=>{
   const number=String(i+1).padStart(3,'0');
   sheets.push({name:'응답 '+number,title:'개별 응답 '+number,subtitle:dep.name+' · 응답 '+number,headers:['문항 번호','문항','선택 답변'],rows:dep.statistics.map((q,j)=>[j+1,q.text,q.options[response.answers[q.id]]]),widths:[14,78,30]});
  });
  const files=[
   ['[Content_Types].xml',declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((s,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'],
   ['_rels/.rels',declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+relationshipNamespace+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml',declaration+'<workbook xmlns="'+mainNamespace+'" xmlns:r="'+relationshipNamespace+'"><sheets>'+sheets.map((s,i)=>'<sheet name="'+escape(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>'],
   ['xl/_rels/workbook.xml.rels',declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((s,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+relationshipNamespace+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId'+(sheets.length+1)+'" Type="'+relationshipNamespace+'/styles" Target="styles.xml"/></Relationships>'],
   ['xl/styles.xml',declaration+"<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><fonts count=\"3\"><font><sz val=\"11\"/><name val=\"Malgun Gothic\"/><color rgb=\"FF27485F\"/></font><font><b/><sz val=\"18\"/><name val=\"Malgun Gothic\"/><color rgb=\"FFFFFFFF\"/></font><font><b/><sz val=\"11\"/><name val=\"Malgun Gothic\"/><color rgb=\"FF32556C\"/></font></fonts><fills count=\"4\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill><fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF0A3159\"/></patternFill></fill><fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFEAF1F5\"/></patternFill></fill></fills><borders count=\"1\"><border/></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"5\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFill=\"1\" applyFont=\"1\"/><xf numFmtId=\"0\" fontId=\"2\" fillId=\"3\" borderId=\"0\" xfId=\"0\" applyFill=\"1\" applyFont=\"1\"/><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyAlignment=\"1\"><alignment wrapText=\"1\" vertical=\"center\"/></xf><xf numFmtId=\"10\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyAlignment=\"1\"><alignment vertical=\"center\"/></xf></cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>"],
   ...sheets.map((s,i)=>['xl/worksheets/sheet'+(i+1)+'.xml',sheet(s)])
  ];
  return zip(files);
 }
 return {create};
})();
