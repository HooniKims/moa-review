const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function csvCell(s){s=String(s??'');if(/^[\s]*[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function reportWarnings(r){return [
  ...(r.errors||[]).map(e=>({...e,title:'파일 읽기 실패'})),
  ...r.documents.flatMap(d=>d.warnings.map(message=>({name:d.name,title:'파일 읽기 안내',message}))),
  ...((r.facts||[]).length?[]:[{name:'',title:'인식한 비교 항목이 없어요',message:'문서 전체가 정상이라는 뜻은 아닙니다. 파일의 명시적 라벨과 표를 확인해 주세요.'}])
];}
function reportCsv(report){
  const rows=[['종류','확인 상태','항목','설명','파일','위치','값','원문'],
    ...reportWarnings(report).map(w=>['읽기 안내','확인 필요',w.title,w.message,w.name,'','','']),
    ...report.issues.flatMap(i=>i.evidence.map(e=>[i.category,i.status==='reviewed'?'확인 완료':'확인 필요',i.title,i.description,e.fileName,e.location,e.display,e.excerpt]))];
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
function reportHtml(r){
  const warnings=reportWarnings(r);
  const guidance=warnings.length?'<h2>읽기 안내</h2><ul>'+warnings.map(w=>`<li><b>${escape(w.title)}${w.name?' · '+escape(w.name):''}</b><br>${escape(w.message)}</li>`).join('')+'</ul>':'';
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>모아검토 검사 결과</title><style>body{font:15px/1.8 'Pretendard','Malgun Gothic',sans-serif;color:#243b38;max-width:1000px;margin:60px auto;padding:0 24px}h1{font-size:32px}small{color:#627772}.card{border:1px solid #dce4df;border-radius:14px;padding:22px;margin:18px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #eee;vertical-align:top;overflow-wrap:anywhere}blockquote{background:#f4f7f4;margin:10px 0;padding:12px}footer{margin-top:30px;color:#627772}@media print{.card{break-inside:avoid}}</style>
<h1>모아검토 · 검사 결과</h1><p>${escape(r.year)}년 기준 · 파일 ${r.documents.length}개 · 확인 항목 ${r.issues.length}개</p><small>${escape(new Date(r.createdAt).toLocaleString('ko-KR'))}</small><p>규칙으로 인식한 항목의 불일치 후보입니다. 같은 행사·대상의 값인지 원본과 함께 확인하세요. 확인 완료 표시는 원본 수정 완료를 의미하지 않습니다.</p>
${guidance}<h2>검사한 파일</h2><ul>${r.documents.map(d=>`<li>${escape(d.name)} (${escape(d.type)})</li>`).join('')}</ul>
${r.issues.length?r.issues.map(i=>`<section class="card"><small>${escape(i.category)} · ${i.status==='reviewed'?'확인 완료':'확인 필요'}</small><h2>${escape(i.title)}</h2><p>${escape(i.description)}</p><table><tr><th>파일</th><th>위치</th><th>값</th></tr>${i.evidence.map(e=>`<tr><td>${escape(e.fileName)}</td><td>${escape(e.location)}</td><td>${escape(e.display)}</td></tr>`).join('')}</table>${i.evidence.map(e=>`<blockquote><b>${escape(e.fileName)}</b><br>${escape(e.excerpt)}</blockquote>`).join('')}</section>`).join(''):`<div class="card">${r.facts?.length?'인식한 범위에서 불일치가 발견되지 않았습니다. 인식하지 못한 항목은 별도로 확인하세요.':'비교할 수 있는 항목이 없어 불일치 여부를 판단하지 못했습니다.'}</div>`}
<footer>모아검토 1.0 · 원본 파일은 변경하지 않았습니다.</footer></html>`;
}
module.exports={reportCsv,reportHtml,escape};