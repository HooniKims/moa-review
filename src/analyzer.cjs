const crypto=require('node:crypto');
const keyOf=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,16);
const categories={people:'인원',date:'날짜',place:'장소',money:'금액',year:'지난 연도',calculation:'계산'};
const normalize=s=>String(s).normalize('NFKC').replace(/\s+/g,' ').trim();
const number=s=>Number(String(s).replace(/[,\s]/g,''));
function labelKind(label) {
  const s=label.replace(/\s/g,'');
  if(/(신청|제출|회신|접수).*(기한|마감|일)|마감일/.test(s)) return ['date','마감일'];
  if(/행사일|실시일|일시|일정|체험일|날짜/.test(s)) return ['date','행사일'];
  if(/교사|교원|인솔/.test(s)&&/인원|명|수|교사|인솔/.test(s)) return ['people','인솔 인원'];
  if(/학생/.test(s)&&/인원|수|학생/.test(s)) return ['people','학생 인원'];
  if(/총인원|전체인원/.test(s)) return ['people','전체 인원'];
  if(/참가인원|참여인원|참가자|참여자|대상인원|예정인원|^인원$/.test(s)) return ['people','참가 인원'];
  if(/장소|목적지/.test(s)) return ['place','행사 장소'];
  if(/총액|총예산|총금액|예산합계|합계|총계|소요예산/.test(s)) return ['money','예산 총액'];
  if(/단가|1인당|인당/.test(s)) return ['money',/식사|식비|급식/.test(s)?'식사 단가':/교통|차량/.test(s)?'교통 단가':'1인당 단가'];
  return null;
}
function analyze(documents,options={}) {
  const year=Number(options.year)||new Date().getFullYear();
  if(year<2000||year>2100) throw new Error('기준 연도는 2000~2100년 사이로 설정해 주세요.');
  const facts=[],issues=[],coverage=[];
  function fact(doc,block,kind,key,value,display,location) {
    const f={documentId:doc.id,fileName:doc.name,kind,key,value:String(value),display:String(display),location:location||block.location,excerpt:block.text};
    if(!facts.some(x=>x.documentId===f.documentId&&x.key===f.key&&x.value===f.value&&x.location===f.location)) facts.push(f);
    return f;
  }
  function issue(kind,title,description,evidence,severity='warning') {
    issues.push({id:keyOf(title+JSON.stringify(evidence.map(e=>[e.documentId,e.location,e.value]))),kind,category:categories[kind],title,description,evidence,severity,status:'pending'});
  }
  function inspect(doc,block,label,value,location,whole=false) {
    const match=labelKind(label); if(!match) return;
    const [kind,key]=match; value=normalize(value);
    if(kind==='people'||kind==='money') {
      const regex=kind==='people'?/^(?:약\s*)?(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*명(?:\s|$|\()/:/^(?:약\s*)?(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*원(?:\s|$|\()/;
      let m=value.match(regex);
      if(!m && !whole && /^-?\d+(?:,\d{3})*(?:\.\d+)?$/.test(value)) m=[value,value];
      if(!m)return;
      const n=number(m[1]); if(!Number.isFinite(n))return;
      if(kind==='people'&&(n<0||!Number.isInteger(n))) {issue('people','인원 값의 형식을 확인해 주세요','인원은 0 이상의 정수인지 확인해 주세요.',[{documentId:doc.id,fileName:doc.name,location:location||block.location,excerpt:block.text,display:value,value}],'error');return;}
      fact(doc,block,kind,key,n,`${n.toLocaleString('ko-KR')}${kind==='people'?'명':'원'}`,location);
    } else if(kind==='place') {
      if(!value||value.length>90)return;
      const v=value.replace(/[.;。]+$/,'').trim();
      if(v&&!/미정|추후|예정지|협의/.test(v))fact(doc,block,kind,key,v.replace(/\s/g,''),v,location);
    } else if(kind==='date') {
      const matches=[...value.matchAll(/(?<![\d.\-/])(?:(\d{4})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?!\d)\s*(?:일|\.)?(?:\s*\(([월화수목금토일])(?:요일)?\))?/g)];
      if(matches.length!==1)return; // 날짜 범위와 복수 일정을 임의로 연결하지 않음
      const m=matches[0], y=Number(m[1]||year),mo=Number(m[2]),d=Number(m[3]);
      const dt=new Date(Date.UTC(y,mo-1,d));
      const evidence={documentId:doc.id,fileName:doc.name,location:location||block.location,excerpt:block.text,display:m[0],value:m[0],kind:'date',key};
      if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d) {issue('date','존재하지 않는 날짜',`${m[0]}은 달력에 없는 날짜입니다. 원문을 확인해 주세요.`,[evidence],'error');return;}
      const v=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const f=fact(doc,block,kind,key,v,`${y}. ${mo}. ${d}.`,location);
      if(m[4]&&m[4]!=='일월화수목금토'[dt.getUTCDay()])issue('date','날짜와 요일이 달라요',`${v}의 요일은 ${'일월화수목금토'[dt.getUTCDay()]}요일입니다.`,[f],'error');
      if(y<year&&!/전년도|작년|지난|실적|결과|이력|참고/.test(block.text))issue('year','지난 연도의 날짜가 남아 있어요',`기준 연도는 ${year}년입니다. ${y}년 일정이 의도된 내용인지 확인해 주세요.`,[f]);
    }
  }
  for(const doc of documents) {
    const before=facts.length; const headers=new Map();
    for(const block of doc.blocks) {
      if(block.cells) {
        const cells=block.cells;
        const kinds=cells.map(c=>labelKind(c.text));
        const scope=block.tableId||block.part;
        const isHeader=cells.filter((c,i)=>kinds[i]||/^(수량|금액)$/.test(c.text)).length>=2 && !cells.some(c=>/^\d/.test(c.text));
        if(isHeader) {headers.set(scope,cells);continue;}
        const header=headers.get(scope);
        cells.forEach((c,i)=>{
          if(i>0&&kinds[i-1]&&!kinds[i])inspect(doc,block,cells[i-1].text,c.text,c.location);
          const h=header?.find(h=>h.column===c.column);
          if(h&&!kinds[i])inspect(doc,block,h.text,c.text,c.location);
        });
        if(header) {
          const get=(rx)=>{const h=header.find(c=>rx.test(c.text));return h?cells.find(c=>c.column===h.column):null;};
          const qty=get(/인원|수량/),unit=get(/단가/),total=get(/총액|합계|금액/);
          const val=c=>c?number(c.text.replace(/명|원|개/g,'')):NaN;
          if(qty&&unit&&total&&[val(qty),val(unit),val(total)].every(Number.isFinite)&&qty.text&&unit.text&&total.text) {
            const expected=Math.round(val(qty)*val(unit)*100)/100;
            if(Math.abs(expected-val(total))>0.01)issue('calculation','수량 × 단가와 금액이 달라요',`${val(qty).toLocaleString('ko-KR')} × ${val(unit).toLocaleString('ko-KR')} = ${expected.toLocaleString('ko-KR')}원입니다. 할인·추가비용이 있는지도 확인해 주세요.`,[qty,unit,total].map(c=>({documentId:doc.id,fileName:doc.name,location:c.location,excerpt:block.text,display:c.text,value:c.text}))); 
          }
        }
      } else {
        // 콜론이 있는 명시적 항목 또는 잘 알려진 라벨에 한해 연결
        const parts=block.text.split(/[;\n]/);
        for(const p of parts) {
          const m=p.match(/^\s*(?:[\d.가-힣]\)\s*)?([^:：]{1,30})[:：]\s*(.+)$/);
          if(m)inspect(doc,block,m[1],m[2],null,false);
          else {
            const m2=p.match(/^(행사일|실시일|일시|참가\s*인원|학생\s*수|총\s*인원|장소|총액|총예산|1인당\s*단가)\s+(.+)$/);
            if(m2)inspect(doc,block,m2[1],m2[2],null,true);
          }
        }
      }
    }
    coverage.push({documentId:doc.id,count:facts.length-before});
  }
  const groups=Map.groupBy(facts,f=>f.kind+'|'+f.key);
  for(const group of groups.values()) {
    if(new Set(group.map(f=>f.documentId)).size<2||new Set(group.map(f=>f.value)).size<2)continue;
    // 한 파일에 동일 항목의 서로 다른 값이 있으면 연결 자체를 사용자에게 확인시킴
    const ambiguous=[...Map.groupBy(group,f=>f.documentId).values()].some(g=>new Set(g.map(f=>f.value)).size>1);
    issue(group[0].kind,`${group[0].key}${ambiguous?'의 비교 기준을 확인해 주세요':'이 서로 달라요'}`,ambiguous?'한 문서에 같은 항목의 값이 여러 개 있습니다. 서로 같은 대상을 가리키는지 먼저 확인해 주세요.':'같은 행사·같은 대상을 설명하는 항목인지 확인한 뒤 직접 수정하거나 원본 프로그램에서 수정해 주세요.',group);
  }
  issues.sort((a,b)=>(a.severity==='error'?0:1)-(b.severity==='error'?0:1));
  return {version:1,year,createdAt:new Date().toISOString(),documents:documents.map(d=>({id:d.id,name:d.name,type:d.type,size:d.size,blockCount:d.blocks.length,warnings:d.warnings})),facts,issues,coverage};
}
module.exports={analyze,labelKind,categories};
