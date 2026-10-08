const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {zipSync,unzipSync,strToU8,strFromU8}=require('fflate');
const {parseDocument}=require('../src/documents.cjs');
const {prepareEdit,applyEdit}=require('../src/document-edit.cjs');
const {saveCopy}=require('../src/edit-storage.cjs');
const zip=parts=>Buffer.from(zipSync(Object.fromEntries(Object.entries(parts).map(([name,value])=>[name,typeof value==='string'?strToU8(value):value]))));
const para=t=>`<hp:p><hp:run charPrIDRef="4"><hp:t>${t}</hp:t></hp:run></hp:p>`;
const hwpx=(body,extra={})=>zip({mimetype:'application/hwp+zip','Contents/section0.xml':`<hs:sec xmlns:hs="s" xmlns:hp="p">${body}</hs:sec>`,'Contents/header.xml':'<header keep="120"/>','BinData/image.png':new Uint8Array([0,255,1,2]),...extra});
const xlsx=(body,extra={})=>zip({'xl/workbook.xml':'<workbook xmlns="x" xmlns:r="r"><sheets><sheet name="예산" r:id="r1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':`<worksheet xmlns="x"><sheetData>${body}</sheetData></worksheet>`,'xl/styles.xml':'<styleSheet xmlns="x"><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',...extra});
const entries=b=>Object.fromEntries(Object.entries(unzipSync(b)).map(([n,v])=>[n,strFromU8(v)]));
const source=(b,file='a.hwpx',index=0)=>parseDocument(b,file).blocks.flatMap(x=>x.cells||[x])[index].source;
test('HWPX changes one exact paragraph and preserves attributes, images and other package parts',()=>{
  const b=hwpx(para('인원: 120명')+para('인원: 120명')),before=Buffer.from(b),s=source(b);
  const {buffer}=applyEdit(b,'a.hwpx',s,'인원: 118명 & <확인> 😀');
  assert.deepEqual(b,before);const old=unzipSync(b),next=unzipSync(buffer);
  for(const name of Object.keys(old))if(name!==s.part)assert.deepEqual(next[name],old[name]);
  assert.equal(prepareEdit(buffer,'a.hwpx',s).text,'인원: 118명 & <확인> 😀');
  assert.equal(parseDocument(buffer,'a.hwpx').blocks[1].text,'인원: 120명');
  assert.match(entries(buffer)[s.part],/charPrIDRef="4"/);assert.equal(Object.keys(next)[0],'mimetype');
});
test('disjoint edits preserve the unchanged styled run between them',()=>{
  const b=hwpx('<hp:p><hp:run charPrIDRef="0"><hp:t>A: 10 </hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>IMPORTANT</hp:t></hp:run><hp:run charPrIDRef="2"><hp:t> C: 20</hp:t></hp:run></hp:p>');
  const result=applyEdit(b,'a.hwpx',source(b),'A: 11 IMPORTANT C: 21');
  assert.match(entries(result.buffer)['Contents/section0.xml'],/<hp:run charPrIDRef="1"><hp:t>IMPORTANT<\/hp:t><\/hp:run>/);
});
test('run splitting, insertion, deletion, entities and Unicode round trip',()=>{
  const b=hwpx('<hp:p><hp:run><hp:t>참가 &amp; </hp:t></hp:run><hp:run><hp:t>인원: 1</hp:t></hp:run><hp:run><hp:t>20명 😀</hp:t></hp:run></hp:p>'),s=source(b);
  for(const text of ['참가 & 인원: 118명 😁','새 참가 & 인원: 120명 😀 끝','참가 & 인원: 0명 😀'])assert.equal(prepareEdit(applyEdit(b,'a.hwpx',s,text).buffer,'a.hwpx',s).text,text);
});
test('only edited paragraphs lose stale layout caches',()=>{
  const b=hwpx(para('인원: 120명').replace('</hp:p>','<hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>')+para('그대로').replace('</hp:p>','<hp:linesegarray><hp:lineseg textpos="2"/></hp:linesegarray></hp:p>'));
  const xml=entries(applyEdit(b,'a.hwpx',source(b),'인원: 1명').buffer)['Contents/section0.xml'];
  assert.equal((xml.match(/<hp:linesegarray>/g)||[]).length,1);assert.match(xml,/textpos="2"/);
});
test('merged-cell coordinates and multiple cell paragraphs are preserved',()=>{
  const b=hwpx('<hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:cellAddr rowAddr="2" colAddr="5"/><hp:cellSpan colSpan="2" rowSpan="1"/><hp:subList>'+para('참가 인원: 120명')+para('장소: 공원')+'</hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>'),s=source(b);
  assert.equal(s.column,5);assert.equal(s.row,2);
  const r=applyEdit(b,'a.hwpx',s,'참가 인원: 118명\n장소: 학교');assert.equal(prepareEdit(r.buffer,'a.hwpx',s).text,'참가 인원: 118명\n장소: 학교');
  assert.match(entries(r.buffer)[s.part],/colSpan="2" rowSpan="1"/);
  assert.throws(()=>applyEdit(b,'a.hwpx',s,'한 문단'),/문단 수/);
});
test('HWPX fields and signed documents are read-only for direct editing',()=>{
  const b=hwpx('<hp:p><hp:run><hp:fieldBegin/><hp:t>인원: 120명</hp:t></hp:run></hp:p>');assert.throws(()=>prepareEdit(b,'a.hwpx',source(b)),/필드/);
  const signed=hwpx(para('인원: 120명'),{'META-INF/signatures.xml':'<signatures/>'});assert.throws(()=>prepareEdit(signed,'a.hwpx',source(signed)),/전자서명/);
});
test('changed source hash, empty input, control characters and invalid positions are refused',()=>{
  const b=hwpx(para('인원: 120명')),s=source(b);
  assert.throws(()=>applyEdit(b,'a.hwpx',s,'인원: 1명','bad-hash'),/변경/);
  for(const v of ['', 'x\x00y','x'.repeat(10001)])assert.throws(()=>applyEdit(b,'a.hwpx',s,v),/내용/);
  assert.throws(()=>prepareEdit(b,'a.hwpx',{...s,index:99}),/위치/);
});
test('HWPX text preview is refreshed and unreferenced stale thumbnail is removed',()=>{
  const b=hwpx(para('인원: 120명'),{'Preview/PrvText.txt':'인원: 120명','Preview/PrvImage.png':new Uint8Array([1,2,3])});
  const r=applyEdit(b,'a.hwpx',source(b),'인원: 118명'),out=entries(r.buffer);
  assert.equal(out['Preview/PrvText.txt'],'인원: 118명');assert.equal(out['Preview/PrvImage.png'],undefined);assert.equal(r.stalePreview,false);
});
test('shared XLSX strings change only the selected cell, keeping other uses and rich text',()=>{
  const b=xlsx('<row r="1"><c r="A1" t="s" s="0"><v>0</v></c><c r="B1" t="s"><v>0</v></c></row>',{'xl/sharedStrings.xml':'<sst xmlns="x"><si><r><rPr><b/></rPr><t>참가 </t></r><r><t>120명</t></r></si></sst>'}),s=source(b,'a.xlsx');
  const r=applyEdit(b,'a.xlsx',s,'참가 118명'),doc=parseDocument(r.buffer,'a.xlsx');
  assert.equal(doc.blocks[0].cells[0].text,'참가 118명');assert.equal(doc.blocks[0].cells[1].text,'참가 120명');
  assert.equal(entries(b)['xl/sharedStrings.xml'],entries(r.buffer)['xl/sharedStrings.xml']);
  assert.match(entries(r.buffer)[s.part],/<rPr><b\/><\/rPr><t>참가 <\/t>/);
});
test('inline strings preserve whitespace and cannot become formulas',()=>{
  const b=xlsx('<row r="1"><c r="A1" t="inlineStr"><is><t>공원</t></is></c></row>'),s=source(b,'a.xlsx');
  const r=applyEdit(b,'a.xlsx',s,' =SUM(1,2) ');assert.equal(prepareEdit(r.buffer,'a.xlsx',s).text,' =SUM(1,2) ');assert.match(entries(r.buffer)[s.part],/xml:space="preserve"/);assert.doesNotMatch(entries(r.buffer)[s.part],/<f>/);
});
test('numeric values retain cell format and invalidate formula caches for recalculation',()=>{
  const b=xlsx('<row r="1"><c r="A1" s="0"><v>120</v></c><c r="B1"><f>A1*2</f><v>240</v></c></row>'),s=source(b,'a.xlsx');
  const r=applyEdit(b,'a.xlsx',s,'118');assert.equal(r.recalculate,true);
  const out=entries(r.buffer);assert.match(out[s.part],/<c r="A1" s="0"><v>118<\/v>/);assert.match(out[s.part],/<f>A1\*2<\/f>/);assert.doesNotMatch(out[s.part],/<v>240<\/v>/);assert.match(out['xl/workbook.xml'],/fullCalcOnLoad="1"/);
  assert.ok(parseDocument(r.buffer,'a.xlsx').warnings.some(w=>w.includes('수식 결과가 없습니다')));
  for(const text of ['118명','1,000','=SUM(A1)','Infinity'])assert.throws(()=>applyEdit(b,'a.xlsx',s,text),/숫자/);
});
test('numeric date editing retains time and handles the 1904 date system',()=>{
  for(const date1904 of [false,true]){
    const extra=date1904?{'xl/workbook.xml':'<workbook xmlns="x" xmlns:r="r"><workbookPr date1904="1"/><sheets><sheet name="예산" r:id="r1"/></sheets></workbook>'}:{};
    const b=xlsx('<row r="1"><c r="A1" s="1"><v>46000.5</v></c></row>',extra),s=source(b,'a.xlsx');
    const r=applyEdit(b,'a.xlsx',s,'2026-10-24');assert.equal(prepareEdit(r.buffer,'a.xlsx',s).text,'2026-10-24');assert.match(entries(r.buffer)[s.part],/\.5<\/v>/);
    assert.throws(()=>applyEdit(b,'a.xlsx',s,'2026-02-30'),/날짜/);
  }
});
test('array formula cached spill values are cleared after an input edit',()=>{
  const b=xlsx('<row r="1"><c r="A1"><f t="array" ref="A1:B1">A2:B2</f><v>1</v></c><c r="B1"><v>2</v></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c></row>');
  const r=applyEdit(b,'a.xlsx',source(b,'a.xlsx',2),'3'),out=entries(r.buffer)['xl/worksheets/sheet1.xml'];
  assert.match(out,/<c r="B1"><\/c>/);assert.match(out,/<c r="A2"><v>3<\/v>/);assert.equal(r.recalculate,true);
});
test('formula, array formula members and protected sheets cannot be overwritten',()=>{
  const b=xlsx('<row r="1"><c r="A1"><f t="array" ref="A1:B1">A2:B2</f><v>1</v></c><c r="B1"><v>2</v></c></row>');
  for(const i of [0,1])assert.throws(()=>prepareEdit(b,'a.xlsx',source(b,'a.xlsx',i)),/수식/);
  const protectedFile=xlsx('',{'xl/worksheets/sheet1.xml':'<worksheet xmlns="x"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><sheetProtection sheet="1"/></worksheet>'});assert.throws(()=>prepareEdit(protectedFile,'a.xlsx',source(protectedFile,'a.xlsx')),/보호/);
});
test('saveCopy never overwrites an input, existing file or hard-link alias',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moa-edit-')),original=path.join(dir,'original.hwpx'),other=path.join(dir,'other.hwpx'),alias=path.join(dir,'alias.hwpx');
  await fs.writeFile(original,'original');await fs.writeFile(other,'existing');await fs.link(original,alias);
  try{
    await assert.rejects(saveCopy(original,original,[original],Buffer.from('new')),/원본/);
    await assert.rejects(saveCopy(other,original,[original],Buffer.from('new')),/같은 이름/);
    await assert.rejects(saveCopy(alias,original,[original],Buffer.from('new')),/같은 이름/);
    await assert.rejects(saveCopy(path.join(dir,'wrong.xlsx'),original,[original],Buffer.from('new')),/확장자/);
    await saveCopy(path.join(dir,'copy.hwpx'),original,[original],Buffer.from('new'));
    assert.equal(await fs.readFile(original,'utf8'),'original');assert.equal(await fs.readFile(other,'utf8'),'existing');assert.equal(await fs.readFile(path.join(dir,'copy.hwpx'),'utf8'),'new');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
