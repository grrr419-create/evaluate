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
 function sheet(title,headers,rows,widths){
  const values=[[title],['업무환경 심리평가 · 부서별 응답 통계'],[],headers,...rows];
  const xml=values.map((row,index)=>'<row r="'+(index+1)+'" ht="'+(index===0?34:index<4?26:42)+'" customHeight="1">'+row.map((value,column)=>{
   const ref=String.fromCharCode(65+column)+(index+1),style=index===0?1:index===3?2:typeof value==='number'&&column===headers.length-1?4:3;
   return typeof value==='number'?'<c r="'+ref+'" s="'+style+'"><v>'+value+'</v></c>':'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+escape(value)+'</t></is></c>';
  }).join('')+'</row>').join('');
  const last=String.fromCharCode(64+headers.length);
  return declaration+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols><sheetData>'+xml+'</sheetData><mergeCells count="2"><mergeCell ref="A1:'+last+'1"/><mergeCell ref="A2:'+last+'2"/></mergeCells></worksheet>';
 }
 function create(dep){
  if(!dep?.unlocked||dep.total<1||dep.completed!==dep.total||!Array.isArray(dep.statistics))throw new Error('전원이 참여한 부서의 통계만 내려받을 수 있습니다.');
  const rows=[];
  for(const q of dep.statistics){
   if(q.options.length!==q.counts.length||q.counts.some(n=>!Number.isInteger(n)||n<0)||q.counts.reduce((a,b)=>a+b,0)!==dep.total)throw new Error('응답 수 검증에 실패했습니다.');
   q.options.forEach((option,index)=>rows.push([dep.name,q.text,option,q.counts[index],dep.total,q.counts[index]/dep.total]));
  }
  const files=[
   ['[Content_Types].xml',declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
   ['_rels/.rels',declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml',declaration+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="부서별 참여현황" sheetId="1" r:id="rId1"/><sheet name="문항별 통계" sheetId="2" r:id="rId2"/></sheets></workbook>'],
   ['xl/_rels/workbook.xml.rels',declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
   ['xl/styles.xml',declaration+'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Malgun Gothic"/><color rgb="FF27485F"/></font><font><b/><sz val="18"/><name val="Malgun Gothic"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="11"/><name val="Malgun Gothic"/><color rgb="FF32556C"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0A3159"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F5"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
   ['xl/worksheets/sheet1.xml',sheet('부서별 평가 참여현황',['소속부서','평가대상(명)','참여완료(명)','공개 상태','참여율'],[[dep.name,dep.total,dep.completed,'전원 참여 완료',1]],[30,18,18,24,16])],
   ['xl/worksheets/sheet2.xml',sheet('문항별 응답 통계',['소속부서','문항','답변','응답 수(명)','전체 인원(명)','응답 비율'],rows,[28,72,20,18,18,16])],
  ];
  return zip(files);
 }
 return {create};
})();
