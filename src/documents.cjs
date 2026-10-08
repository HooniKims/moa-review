const { unzipSync, strFromU8 } = require('fflate');
const { DOMParser } = require('@xmldom/xmldom');
const path = require('node:path');
const crypto = require('node:crypto');
const nodes = (root, name) => Array.from(root.getElementsByTagNameNS('*', name));
const children = (root, name) => Array.from(root.childNodes || []).filter(n => n.nodeType === 1 && n.localName === name);
const text = n => (n?.textContent || '').replace(/\s+/g, ' ').trim();
const ancestor = (n, name) => { for (let p=n.parentNode;p;p=p.parentNode) if(p.localName===name) return p; return null; };
function xml(bytes) {
  const source = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('외부 엔티티가 포함된 XML은 읽을 수 없습니다.');
  const errors=[];
  const doc=new DOMParser({onError:(level,msg)=>{ if(level!=='warning') errors.push(msg); }}).parseFromString(source,'text/xml');
  if(errors.length || !doc.documentElement) throw new Error('문서 내부 XML이 손상되었습니다.');
  return doc;
}
function unpack(buffer) {
  if(buffer.length > 50*1024*1024) throw new Error('파일은 50MB 이하만 지원합니다.');
  let total=0, count=0;
  try { return unzipSync(new Uint8Array(buffer), {filter(entry) {
    if(++count>5000) throw new Error('압축 항목이 너무 많습니다.');
    if(!/\.xml$|\.rels$|^mimetype$/i.test(entry.name)) return false;
    total+=entry.originalSize;
    if(entry.originalSize>16*1024*1024 || total>48*1024*1024) throw new Error('문서의 압축 해제 크기가 지원 범위를 초과합니다.');
    return true;
  }}); } catch(e) { throw new Error(e.message?.includes('크기')||e.message?.includes('항목')?e.message:'파일이 손상되었거나 암호화되어 있습니다. 암호 없는 HWPX 또는 XLSX로 저장해 주세요.'); }
}
function parseHwpx(files) {
  const sections=Object.keys(files).filter(n=>/^Contents\/section\d+\.xml$/i.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  if(!sections.length) throw new Error('HWPX 본문을 찾을 수 없습니다. 구형 HWP는 HWPX로 저장해 주세요.');
  const blocks=[];
  for(const [si,name] of sections.entries()) {
    const doc=xml(files[name]); const tables=nodes(doc,'tbl');
    const paragraphs=nodes(doc,'p');
    paragraphs.forEach((p,i)=>{
      const ts=nodes(p,'t').filter(n=>ancestor(n,'p')===p);
      const value=ts.map(n=>n.textContent||'').join('').trim();
      if(!value || ancestor(p,'tc')) return;
      blocks.push({text:value,location:`구역 ${si+1} · 문단 ${i+1}`,part:name,source:{kind:'hwpx-paragraph',part:name,index:i}});
    });
    tables.forEach((table,ti)=>{
      children(table,'tr').forEach((row,ri)=>{
        const cells=children(row,'tc').map((cell,ci)=>{
          const addr=children(cell,'cellAddr')[0];
          const r=Number(addr?.getAttribute('rowAddr')??ri)+1,c=Number(addr?.getAttribute('colAddr')??ci)+1;
          const value=nodes(cell,'p').filter(p=>ancestor(p,'tc')===cell).map(p=>nodes(p,'t').filter(t=>ancestor(t,'p')===p).map(t=>t.textContent||'').join('')).join(' ').trim();
          return {text:value,location:`구역 ${si+1} · 표 ${ti+1} · ${r}행 ${c}열`,column:c,source:{kind:'hwpx-cell',part:name,table:ti,row:r-1,column:c-1}};
        });
        if(cells.some(c=>c.text)) blocks.push({text:cells.map(c=>c.text).join(' | '),location:`구역 ${si+1} · 표 ${ti+1} · ${ri+1}행`,cells,part:name,tableId:`${name}:table${ti}`});
      });
    });
  }
  return {blocks,warnings:[]};
}
function excelDate(serial,date1904) {
  const value=Number(serial);
  if(!Number.isFinite(value)||value<0||value>2958465) return serial;
  const base=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30);
  const d=new Date(base+Math.floor(value)*86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function parseXlsx(files) {
  if(!files['xl/workbook.xml']) throw new Error('XLSX 통합 문서를 찾을 수 없습니다.');
  const wb=xml(files['xl/workbook.xml']);
  const rels=files['xl/_rels/workbook.xml.rels']?nodes(xml(files['xl/_rels/workbook.xml.rels']),'Relationship'):[];
  const shared=files['xl/sharedStrings.xml']?nodes(xml(files['xl/sharedStrings.xml']),'si').map(si=>nodes(si,'t').map(t=>t.textContent||'').join('')):[];
  const styleDoc=files['xl/styles.xml']?xml(files['xl/styles.xml']):null;
  const custom=new Map(styleDoc?nodes(styleDoc,'numFmt').map(n=>[Number(n.getAttribute('numFmtId')),n.getAttribute('formatCode')]):[]);
  const cellXfs=styleDoc?nodes(styleDoc,'cellXfs')[0]:null;
  const dateStyles=new Set((cellXfs?children(cellXfs,'xf'):[]).flatMap((n,i)=>{
    const id=Number(n.getAttribute('numFmtId')),fmt=(custom.get(id)||'').replace(/"[^"]*"|\[[^\]]*\]/g,'');
    return ((id>=14&&id<=17)||(id>=22&&id<=22)||(id>=27&&id<=36)||(id>=50&&id<=58)||/[yd]/i.test(fmt))?[i]:[];
  }));
  const date1904=['1','true'].includes(nodes(wb,'workbookPr')[0]?.getAttribute('date1904'));
  const blocks=[],warnings=[];
  for(const sheet of nodes(wb,'sheet')) {
    const rel=rels.find(r=>r.getAttribute('Id')===sheet.getAttribute('r:id'));
    if(!rel || rel.getAttribute('TargetMode')==='External') continue;
    const target=rel.getAttribute('Target').replace(/\\/g,'/');
    const part=target.startsWith('/')?target.slice(1):path.posix.normalize('xl/'+target);
    if(!files[part]) { warnings.push(`${sheet.getAttribute('name')}: 시트 내용을 찾을 수 없습니다.`); continue; }
    const sd=xml(files[part]),sn=sheet.getAttribute('name');
    if(sheet.getAttribute('state')==='hidden'||sheet.getAttribute('state')==='veryHidden') warnings.push(`${sn}: 숨김 시트도 검사에 포함했습니다.`);
    for(const row of nodes(sd,'row')) {
      const cells=children(row,'c').map(c=>{
        const ref=c.getAttribute('r'),type=c.getAttribute('t'),f=children(c,'f')[0],v=children(c,'v')[0];
        let value=type==='s'?(shared[Number(text(v))]??''):type==='inlineStr'?nodes(c,'t').map(t=>t.textContent||'').join(''):text(v);
        if(type==='e') {warnings.push(`${sn}!${ref}: 엑셀 오류값 ${value}`);value='';}
        if(f&&!v) warnings.push(`${sn}!${ref}: 수식 결과가 없습니다. 엑셀에서 재계산 후 저장해 주세요.`);
        if(dateStyles.has(Number(c.getAttribute('s')))&&value&&type!=='s'&&type!=='inlineStr') value=excelDate(value,date1904);
        return {text:value,location:`${sn}!${ref}`,column:ref?.replace(/\d/g,''),formula:f?text(f):undefined,source:{kind:'xlsx-cell',part,ref,date:dateStyles.has(Number(c.getAttribute('s')))&&type!=='s'&&type!=='inlineStr',date1904}};
      });
      if(cells.some(c=>c.text)) blocks.push({text:cells.map(c=>c.text).join(' | '),location:`${sn} · ${row.getAttribute('r')}행`,cells,part});
    }
  }
  if(blocks.some(b=>b.cells?.some(c=>c.formula))) warnings.push('수식은 파일에 저장된 계산 결과를 읽습니다. 최신 값이 필요하면 엑셀에서 재계산 후 저장해 주세요.');
  return {blocks,warnings};
}
function parseDocument(buffer,filePath) {
  const extension=path.extname(filePath).toLowerCase();
  if(!['.hwpx','.xlsx'].includes(extension)) throw new Error('HWPX와 XLSX 파일만 지원합니다.');
  const files=unpack(buffer),parsed=extension==='.hwpx'?parseHwpx(files):parseXlsx(files);
  if(!parsed.blocks.length) throw new Error('읽을 수 있는 텍스트가 없습니다. 이미지·스캔 문서는 지원하지 않습니다.');
  if(parsed.blocks.length>30000) throw new Error('문서의 문단·행이 30,000개를 초과합니다. 파일을 나누어 주세요.');
  return {id:crypto.createHash('sha256').update(filePath).digest('hex').slice(0,16),sha256:crypto.createHash('sha256').update(buffer).digest('hex'),name:path.basename(filePath),path:filePath,type:extension.slice(1).toUpperCase(),size:buffer.length,...parsed};
}
module.exports={parseDocument,xml,unpack,excelDate};
