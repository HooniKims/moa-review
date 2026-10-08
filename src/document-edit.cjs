'use strict';
// Deterministic local editing. Patch the selected XML text, never rebuild a document.
const {unzipSync,zipSync,strToU8,strFromU8}=require('fflate');
const {xml,parseDocument,excelDate}=require('./documents.cjs');
const crypto=require('node:crypto');
const {diffChars}=require('diff');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r/g,'&#13;');
const decode=s=>s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>v[0]==='#'?String.fromCodePoint(parseInt(v.slice(v[1]?.toLowerCase()==='x'?2:1),v[1]?.toLowerCase()==='x'?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[v]));
const fail=message=>{throw new Error(message);};
function archive(buffer){
  if(buffer.length>50*1024*1024)fail('50MB 이하 파일만 수정할 수 있습니다.');
  let size=0;const seen=new Set();
  const files=unzipSync(new Uint8Array(buffer),{filter:e=>{
    if(seen.has(e.name)||seen.size>=5000||/(^|\/)\.\.?(\/|$)|^[/\\]|\\|^(?:__proto__|constructor|prototype)$/.test(e.name))fail('안전하게 다시 저장할 수 없는 압축 구조입니다.');
    seen.add(e.name);size+=e.originalSize;
    if(e.originalSize>64*1024*1024||size>128*1024*1024)fail('수정 가능한 압축 해제 크기를 초과합니다.');
    return true;
  }});
  if(Object.keys(files).some(n=>/_xmlsignatures|(?:^|\/)signatures?[^/]*\.xml$/i.test(n)))fail('전자서명이 있는 문서는 원본 프로그램에서 수정해 주세요.');
  return files;
}
// Index validated XML while preserving original prefixes, attributes and untouched bytes.
function indexXml(source){
  if(source.length>16*1024*1024)fail('XML 크기가 수정 범위를 초과합니다.');
  xml(strToU8(source));const stack=[],all=[];
  const tokens=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
  for(const m of source.matchAll(tokens)){
    if(/^<[!?]/.test(m[0]))continue;
    const name=m[0].match(/^<\/?([\w:.-]+)/)[1];
    if(m[0].startsWith('</')){const n=stack.pop();if(!n||n.name!==name)fail('XML 위치를 확인할 수 없습니다.');n.close=m.index;n.end=m.index+m[0].length;continue;}
    const n={name,local:name.split(':').pop(),start:m.index,open:m.index+m[0].length,children:[],parent:stack.at(-1)};
    n.parent?.children.push(n);all.push(n);
    if(/\/\s*>$/.test(m[0])){n.close=n.open;n.end=n.open;n.self=true;}else stack.push(n);
  }
  if(stack.length)fail('XML 위치를 확인할 수 없습니다.');
  return {source,all};
}
const descendants=n=>n.children.flatMap(c=>[c,...descendants(c)]);
const nearest=(n,name)=>{for(let p=n.parent;p;p=p.parent)if(p.local===name)return p;return null;};
const attr=(tree,n,key)=>{const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=tree.source.slice(n.start,n.open).match(new RegExp('\\s'+escaped+'\\s*=\\s*(["\'])(.*?)\\1','s'));return m?decode(m[2]):null;};
const content=(tree,n)=>n.self?'':tree.source.slice(n.open,n.close);
function setAttr(open,key,value){
  const re=new RegExp('(\\s'+key+'\\s*=\\s*)(["\']).*?\\2','s');
  return re.test(open)?open.replace(re,(_m,p)=>p+'"'+value+'"'):open.replace(/\s*(\/?>)$/,` ${key}="${value}"$1`);
}
function textOf(tree,n){const raw=content(tree,n);if(n.children.length||raw.includes('<'))fail('개체나 특수 텍스트가 포함된 부분은 원본 프로그램에서 수정해 주세요.');return decode(raw);}
function patches(source,edits){
  let boundary=source.length;
  for(const [start,end,replacement] of edits.sort((a,b)=>b[0]-a[0])){if(end>boundary||start>end)fail('편집 범위가 겹칩니다.');source=source.slice(0,start)+replacement+source.slice(end);boundary=start;}
  return source;
}
function replaceContent(tree,n,value,preserveSpace=false){
  let open=tree.source.slice(n.start,n.open);
  if(preserveSpace)open=setAttr(open,'xml:space','preserve');
  if(n.self)open=open.replace(/\/\s*>$/, '>');
  return [n.start,n.end,open+escape(value)+`</${n.name}>`];
}
function editRuns(tree,textNodes,next){
  if(!textNodes.length)fail('수정할 텍스트를 찾을 수 없습니다.');
  const values=textNodes.map(n=>textOf(tree,n)),before=values.join('');
  const changes=diffChars(before,next,{timeout:300,maxEditLength:10000});
  if(!changes)fail('변경 범위가 너무 큽니다. 한 번에 수정할 내용을 줄여 주세요.');
  let total=0;const ends=values.map(value=>total+=value.length),updated=values.map(()=> '');
  const owner=offset=>{const i=ends.findIndex(end=>offset<end);return i<0?values.length-1:i;};
  let offset=0,removedAt=null;
  for(const change of changes){
    if(change.removed){removedAt??=offset;offset+=change.value.length;}
    else if(change.added)updated[owner(removedAt??offset)]+=change.value;
    else {removedAt=null;let rest=change.value;while(rest.length){const i=owner(offset),length=Math.min(rest.length,ends[i]-offset);if(length<=0)fail('글자 서식의 경계를 확인하지 못했습니다.');updated[i]+=rest.slice(0,length);rest=rest.slice(length);offset+=length;}}
  }
  return updated.flatMap((value,i)=>value===values[i]?[]:[replaceContent(tree,textNodes[i],value,tree.all[0]?.local!=='sec')]);
}
function hwpxTarget(tree,source){
  let paragraphs;
  if(source.kind==='hwpx-paragraph')paragraphs=[tree.all.filter(n=>n.local==='p')[source.index]];
  else {
    const table=tree.all.filter(n=>n.local==='tbl')[source.table];if(!table)fail('표를 찾을 수 없습니다.');
    const candidates=[];
    table.children.filter(n=>n.local==='tr').forEach((row,ri)=>row.children.filter(n=>n.local==='tc').forEach((cell,ci)=>{
      const addr=cell.children.find(n=>n.local==='cellAddr');
      if(Number(addr?attr(tree,addr,'rowAddr'):ri)===source.row&&Number(addr?attr(tree,addr,'colAddr'):ci)===source.column)candidates.push(cell);
    }));
    if(candidates.length!==1)fail('표 셀의 위치가 명확하지 않습니다.');
    const cell=candidates[0];if(descendants(cell).some(n=>n.local==='tbl'))fail('중첩 표가 있는 셀은 원본 프로그램에서 수정해 주세요.');
    paragraphs=descendants(cell).filter(n=>n.local==='p'&&nearest(n,'tc')===cell);
  }
  if(!paragraphs.length||paragraphs.some(n=>!n))fail('문단 위치를 찾을 수 없습니다.');
  const allowed=new Set(['run','t','linesegarray','lineseg']);
  for(const p of paragraphs){
    let openFields=0;for(const n of tree.all){if(n.start>=p.start)break;if(n.local==='fieldBegin')openFields++;if(n.local==='fieldEnd')openFields=Math.max(0,openFields-1);}
    if(openFields||descendants(p).some(n=>!allowed.has(n.local)))fail('필드·개체가 있는 문단은 원본 프로그램에서 수정해 주세요.');
  }
  const groups=paragraphs.map(p=>descendants(p).filter(n=>n.local==='t'));
  const values=groups.map(group=>group.map(n=>textOf(tree,n)).join(''));
  if(values.some(v=>/[\r\n]/.test(v)))fail('특수 줄바꿈이 있는 문단은 원본 프로그램에서 수정해 주세요.');
  return {paragraphs,groups,values,text:values.join('\n'),type:'text',hint:paragraphs.length>1?'문단 사이의 줄바꿈을 유지해 주세요. 바뀐 부분의 기존 글자 서식을 사용합니다.':'라벨·단위·요일을 포함한 원문입니다. 필요한 부분만 수정해 주세요.'};
}
function inRange(ref,range){
  const point=s=>{const m=s?.replace(/\$/g,'').match(/^([A-Z]+)(\d+)$/);if(!m)return null;return [Array.from(m[1]).reduce((a,c)=>a*26+c.charCodeAt(0)-64,0),Number(m[2])];};
  const p=point(ref),parts=range.split(':'),a=point(parts[0]),b=point(parts[1]||parts[0]);
  return p&&a&&b&&p[0]>=a[0]&&p[0]<=b[0]&&p[1]>=a[1]&&p[1]<=b[1];
}
function xlsxTarget(files,tree,source){
  if(files['xl/metadata.xml']&&strFromU8(files['xl/metadata.xml']).includes('XLDAPR'))fail('동적 배열이 있는 통합 문서는 엑셀에서 수정해 주세요.');
  if(tree.all.some(n=>n.local==='sheetProtection'))fail('보호된 시트는 엑셀에서 보호 설정을 확인해 주세요.');
  const found=tree.all.filter(n=>n.local==='c'&&attr(tree,n,'r')===source.ref);if(found.length!==1)fail('셀 위치가 명확하지 않습니다.');
  const cell=found[0],formula=cell.children.find(n=>n.local==='f');
  if(formula||tree.all.some(n=>n.local==='f'&&attr(tree,n,'ref')&&inRange(source.ref,attr(tree,n,'ref'))))fail('수식 또는 배열 수식 셀입니다. 수량·단가 등 입력 셀을 수정하거나 엑셀에서 계산식을 편집해 주세요.');
  if(attr(tree,cell,'cm')||attr(tree,cell,'vm'))fail('확장 데이터가 있는 셀은 엑셀에서 수정해 주세요.');
  const value=cell.children.find(n=>n.local==='v'),type=attr(tree,cell,'t')||'n';
  if(type==='n'){
    if(!value||!Number.isFinite(Number(textOf(tree,value))))fail('숫자 셀의 원래 값을 확인할 수 없습니다.');
    const raw=textOf(tree,value);return {cell,value,type:source.date?'date':'number',text:source.date?excelDate(raw,source.date1904):raw,raw,hint:source.date?'날짜는 YYYY-MM-DD 형식으로 입력하세요. 기존 셀 서식과 시간 값은 유지합니다.':'단위와 쉼표 없이 숫자를 입력하세요. 기존 셀 서식은 유지합니다.'};
  }
  if(!['s','inlineStr'].includes(type))fail('이 셀 형식은 엑셀에서 수정해 주세요.');
  let stringTree=tree,stringNode=cell.children.find(n=>n.local==='is');
  if(type==='s'){
    if(!files['xl/sharedStrings.xml']||!value)fail('공유 문자열을 찾을 수 없습니다.');
    stringTree=indexXml(strFromU8(files['xl/sharedStrings.xml']));
    const i=Number(textOf(tree,value));if(!Number.isInteger(i)||i<0)fail('공유 문자열 번호가 올바르지 않습니다.');
    stringNode=stringTree.all.filter(n=>n.local==='si')[i];
  }
  if(!stringNode)fail('셀의 텍스트를 찾을 수 없습니다.');
  if(descendants(stringNode).some(n=>['rPh','phoneticPr'].includes(n.local)))fail('발음 정보가 있는 셀은 엑셀에서 수정해 주세요.');
  const textNodes=descendants(stringNode).filter(n=>n.local==='t');
  return {cell,value,shared:type==='s',stringTree,stringNode,textNodes,type:'text',text:textNodes.map(n=>textOf(stringTree,n)).join(''),hint:'선택한 셀만 수정합니다. 다른 셀에서 같은 문구를 사용해도 함께 바뀌지 않습니다.'};
}
function prepareEdit(buffer,filePath,source){
  if(!source||!['hwpx-paragraph','hwpx-cell','xlsx-cell'].includes(source.kind))fail('수정할 원문 위치를 찾을 수 없습니다.');
  const parsed=parseDocument(buffer,filePath);
  const match=parsed.blocks.flatMap(b=>b.cells||[b]).filter(b=>JSON.stringify(b.source)===JSON.stringify(source));
  if(match.length!==1)fail('수정할 위치가 명확하지 않습니다. 다시 검사해 주세요.');
  const files=archive(buffer);if(!files[source.part])fail('문서 본문을 찾을 수 없습니다.');
  const tree=indexXml(strFromU8(files[source.part]));
  const target=source.kind.startsWith('hwpx-')?hwpxTarget(tree,source):xlsxTarget(files,tree,source);
  if(target.text.length>10000)fail('10,000자를 넘는 문단·셀은 원본 프로그램에서 수정해 주세요.');
  return {files,tree,target,text:target.text,type:target.type,hint:target.hint,sha256:hash(buffer)};
}
function clearFormulaCaches(files){
  let changed=false;
  for(const name of Object.keys(files).filter(n=>/^xl\/worksheets\/[^/]+\.xml$/.test(n))){
    const tree=indexXml(strFromU8(files[name])),edits=[];
    const ranges=tree.all.filter(n=>n.local==='f'&&attr(tree,n,'ref')).map(n=>attr(tree,n,'ref'));
    for(const cell of tree.all.filter(n=>n.local==='c'))if(cell.children.some(n=>n.local==='f')||ranges.some(range=>inRange(attr(tree,cell,'r'),range)))for(const v of cell.children.filter(n=>n.local==='v'))edits.push([v.start,v.end,'']);
    if(edits.length){files[name]=strToU8(patches(tree.source,edits));changed=true;}
  }
  if(changed){
    const tree=indexXml(strFromU8(files['xl/workbook.xml'])),calc=tree.all.find(n=>n.local==='calcPr');
    if(calc){let open=tree.source.slice(calc.start,calc.open);for(const [k,v] of Object.entries({calcMode:'auto',fullCalcOnLoad:'1',forceFullCalc:'1'}))open=setAttr(open,k,v);files['xl/workbook.xml']=strToU8(patches(tree.source,[[calc.start,calc.open,open]]));}
    else {const root=tree.all[0],prefix=root.name.includes(':')?root.name.split(':')[0]+':':'';const before=root.children.find(n=>['oleSize','customWorkbookViews','pivotCaches','smartTagPr','smartTagTypes','webPublishing','fileRecoveryPr','webPublishObjects','extLst'].includes(n.local));const at=before?.start??root.close;files['xl/workbook.xml']=strToU8(patches(tree.source,[[at,at,`<${prefix}calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>`]]));}
  }
  return changed;
}
function refreshHwpxPreview(files){
  const textParts=[];
  for(const name of Object.keys(files).filter(n=>/^Contents\/section\d+\.xml$/i.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))){
    const doc=xml(files[name]);
    for(const p of Array.from(doc.getElementsByTagNameNS('*','p'))){
      const values=Array.from(p.getElementsByTagNameNS('*','t')).filter(t=>{for(let q=t.parentNode;q;q=q.parentNode)if(q.localName==='p')return q===p;return false;}).map(t=>t.textContent||'');
      if(values.length)textParts.push(values.join(''));
    }
  }
  for(const name of Object.keys(files).filter(n=>/^Preview\/PrvText\.txt$/i.test(n)))files[name]=strToU8(Array.from(textParts.join('\r\n')).slice(0,4096).join(''));
  let staleImage=false;
  for(const name of Object.keys(files).filter(n=>/^Preview\/PrvImage\./i.test(n))){
    const referenced=Object.entries(files).some(([part,bytes])=>/\.(?:xml|hpf|rdf)$/i.test(part)&&strFromU8(bytes).toLowerCase().includes(name.split('/').at(-1).toLowerCase()));
    if(referenced)staleImage=true;else delete files[name];
  }
  return staleImage;
}
function applyEdit(buffer,filePath,source,next,expectedHash){
  if(expectedHash&&hash(buffer)!==expectedHash)fail('검사 후 원본 파일이 변경되었습니다. 다시 검사한 뒤 수정해 주세요.');
  if(typeof next!=='string'||!next.trim()||next.length>10000||/[\x00-\x08\x0B\x0C\x0E-\x1F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(next))fail('저장할 내용을 확인해 주세요. 빈 값·제어 문자·10,000자 초과 내용은 저장할 수 없습니다.');
  const {files,tree,target}=prepareEdit(buffer,filePath,source);
  if(next===target.text)fail('변경한 내용이 없습니다.');
  let edits=[],recalculate=false,stalePreview=false;
  if(source.kind.startsWith('hwpx-')){
    const parts=next.replace(/\r\n/g,'\n').split('\n');if(parts.length!==target.groups.length)fail('원래 문단 수를 유지해 주세요. 문단 추가·삭제는 한글에서 할 수 있습니다.');
    target.groups.forEach((group,i)=>{if(parts[i]!==target.values[i]){edits.push(...editRuns(tree,group,parts[i]));for(const n of target.paragraphs[i].children.filter(n=>n.local==='linesegarray'))edits.push([n.start,n.end,'']);}});
  }else if(target.type==='number'||target.type==='date'){
    let value=next.trim();
    if(target.type==='number'){if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)||!Number.isFinite(Number(value)))fail('단위와 쉼표 없이 유효한 숫자를 입력해 주세요.');}
    else {const date=new Date(value+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value||value<(source.date1904?'1904-01-01':'1900-03-01'))fail('유효한 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.');const epoch=source.date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30);value=String((date.getTime()-epoch)/86400000+Number(target.raw)%1);}
    edits.push(replaceContent(tree,target.value,value));
  }else if(target.shared){
    const st=target.stringTree,n=target.stringNode;
    const innerEdits=editRuns(st,target.textNodes,next);const patched=patches(st.source,innerEdits);const newTree=indexXml(patched),newNode=newTree.all.filter(x=>x.local==='si')[st.all.filter(x=>x.local==='si').indexOf(n)];
    const prefix=newNode.name.includes(':')?newNode.name.split(':')[0]+':':'';
    const declarations=st.source.slice(st.all[0].start,st.all[0].open).match(/\sxmlns(?::[\w.-]+)?\s*=\s*(?:"[^"]*"|'[^']*')/g)||[];
    const inline=`<${prefix}is${declarations.join('')}>${content(newTree,newNode)}</${prefix}is>`;
    const open=setAttr(tree.source.slice(target.cell.start,target.cell.open),'t','inlineStr');
    edits.push([target.cell.start,target.cell.open,open],[target.value.start,target.value.end,inline]);
  }else edits.push(...editRuns(tree,target.textNodes,next));
  if(!edits.length)fail('변경한 내용이 없습니다.');
  files[source.part]=strToU8(patches(tree.source,edits));
  if(source.kind==='xlsx-cell')recalculate=clearFormulaCaches(files);
  else stalePreview=refreshHwpxPreview(files);
  for(const [name,bytes] of Object.entries(files))if(/\.xml$/i.test(name))xml(bytes);
  const output=Object.create(null);
  if(files.mimetype)output.mimetype=[files.mimetype,{level:0}];
  for(const [name,bytes] of Object.entries(files))if(name!=='mimetype')output[name]=bytes;
  const result=Buffer.from(zipSync(output,{level:6}));
  if(result.length>50*1024*1024)fail('수정본이 50MB를 초과합니다. 원본 프로그램에서 저장해 주세요.');
  const verify=prepareEdit(result,filePath,source);
  if(target.type!=='number'&&target.type!=='date'&&verify.text!==next.replace(/\r\n/g,'\n'))fail('수정본의 내용을 확인하지 못했습니다. 파일을 저장하지 않았습니다.');
  return {buffer:result,recalculate,stalePreview};
}
module.exports={prepareEdit,applyEdit,hash,indexXml};
