const $=s=>document.querySelector(s);
const icons={layers:'M12 3 2 8l10 5 10-5-10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',book:'M4 3h12a3 3 0 0 1 3 3v15H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm-1 15a3 3 0 0 1 3-3h13M7 7h8M7 10h6',shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',lock:'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3',plus:'M12 5v14M5 12h14',check:'m5 12 4 4L19 6',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',sparkles:'m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3ZM21 2v4M19 4h4',compare:'M4 5h6v14H4V5Zm10 0h6v14h-6V5ZM7 8v2m10 4v2M9 12h6',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',alert:'m12 3 10 18H2L12 3Zm0 6v5m0 3v.1',file:'M5 2h9l5 5v15H5V2Zm9 0v6h5M8 12h8M8 16h6',pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'};
icons.settings='M4 7h16M4 17h16M8 4v6M16 14v6';
const icon=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[n]||icons.file}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let files=[],report=null,documents=[],selected=null,filter='all',busy=false,statuses={},toastTimer;
$('#year').value=new Date().getFullYear();
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function notice(messages=[]){$('#notice').textContent=messages.join('\n');$('#notice').hidden=!messages.length;}
function empty(title,subtitle,ic='search',loading=false){return `<div class="empty-state ${loading?'loading':''}"><div class="state-icon">${icon(ic)}</div><h3>${esc(title)}</h3><p>${esc(subtitle).replace(/\n/g,'<br>')}</p></div>`;}
function setBusy(v){busy=v;for(const id of ['scan','demo','pick-more','new-task','year'])$('#'+id).disabled=v;$('#export').disabled=v||!report;$('#scan-dot').classList.toggle('busy',v);$('#scan-label').textContent=v?'검사하고 있어요…':report?'다시 검사':'검사 시작';}
function invalidate(){report=null;documents=[];selected=null;statuses={};$('#export').disabled=true;$('#coverage-note').hidden=true;$('#scan-label').textContent='검사 시작';render();}
function addResult(r,demo=false){if(r.error){notice([r.error]);return;}const previous=files.length;for(const f of r.files||[])if(!files.some(x=>x.id===f.id))files.push(f);if(files.length>30){files=files.slice(0,30);r.errors.push('최대 30개까지만 추가했습니다.');}notice(r.errors||[]);if(files.length!==previous)invalidate();else if(!r.errors?.length&&r.files?.length)toast('이미 추가한 파일입니다.');if(demo){$('#year').value=2026;invalidate();toast('가상 행사 예제를 불러왔습니다.');}}
async function pick(){if(busy)return;try{addResult(await window.moa.selectFiles());}catch(e){notice([e.message]);}}
$('#pick-empty').onclick=e=>{e.stopPropagation();pick();};$('#pick-more').onclick=pick;$('#drop-zone').onclick=pick;$('#drop-zone').onkeydown=e=>{if(e.target===$('#drop-zone')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();pick();}};
window.addEventListener('dragover',e=>{e.preventDefault();if(!busy)$('#drop-zone').classList.add('dragging');});
window.addEventListener('dragleave',e=>{if(!e.relatedTarget)$('#drop-zone').classList.remove('dragging');});
window.addEventListener('drop',async e=>{e.preventDefault();$('#drop-zone').classList.remove('dragging');if(busy)return;try{addResult(await window.moa.addDropped(Array.from(e.dataTransfer.files)));}catch(err){notice([err.message]);}});
$('#demo').onclick=async()=>{try{addResult(await window.moa.demo(),true);}catch(e){notice([e.message]);}};
$('#year').oninput=()=>{invalidate();};
function renderFiles(){
  $('#file-list').innerHTML=files.map(f=>`<div class="file-item"><div class="file-type ${f.type==='XLSX'?'xlsx':''}">${esc(f.type)}</div><div class="file-text"><button class="file-name" data-file="${f.id}" title="읽은 정보 보기">${esc(f.name)}</button><small>${f.size<1024?f.size+' B':Math.ceil(f.size/1024)+' KB'}${report?' · '+(report.coverage.find(c=>c.documentId===f.id)?.count??0)+'개 인식':''}</small></div><button class="file-remove" data-remove="${f.id}" aria-label="${esc(f.name)} 제거" ${busy?'disabled':''}>×</button></div>`).join('');
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{if(busy)return;files=files.filter(f=>f.id!==b.dataset.remove);invalidate();notice([]);});
  document.querySelectorAll('[data-file]').forEach(b=>b.onclick=()=>showDocument(b.dataset.file));
}
function render(){
  $('#empty-view').hidden=files.length>0;$('#workspace').hidden=!files.length;$('#file-count').innerHTML=files.length+'<span>개</span>';$('#file-badge').textContent=files.length;
  const reviewed=report?.issues.filter(i=>statuses[i.id]==='reviewed').length||0;
  $('#pending-count').textContent=report?report.issues.length-reviewed:'—';$('#reviewed-count').textContent=report?reviewed:'—';$('#issue-badge').textContent=report?.issues.length||0;
  $('#scan-status').textContent=busy?'문서를 읽고 대조하는 중':report?'검사가 끝났어요':'검사할 준비가 되었어요';renderFiles();renderResults();renderDetail();
}
function visibleIssues(){const q=$('#search').value.trim().toLowerCase();return (report?.issues||[]).filter(i=>(filter==='all'||i.kind===filter||(filter==='money'&&i.kind==='calculation'))&&(!$('#pending-only').checked||statuses[i.id]!=='reviewed')&&(!q||JSON.stringify(i).toLowerCase().includes(q)));}
function renderResults(){
  const list=$('#result-list');
  if(busy){list.innerHTML=empty('문서 사이의 차이를 찾고 있어요','파일의 크기에 따라 잠시 걸릴 수 있어요.','compare',true);return;}
  if(!report){list.innerHTML=empty('검사를 시작할 수 있습니다','왼쪽의 검사 시작을 눌러\n문서 사이의 차이를 확인해 보세요.','layers');return;}
  const issues=visibleIssues();
  if(!issues.length){list.innerHTML=empty(report.facts.length===0?'인식한 비교 항목이 없어요':report.issues.length?'해당하는 항목이 없어요':'발견된 불일치가 없어요',report.facts.length===0?'파일의 명시적 라벨과 표를 확인해 주세요.\n문서 전체가 정상이라는 뜻은 아니에요.':report.issues.length?'필터나 검색어를 바꿔 보세요.':'인식하지 못한 정보와 비교 대상이 없는 값은\n별도로 확인해 주세요.','check');return;}
  list.innerHTML=issues.map(i=>`<button class="issue-card ${selected===i.id?'selected':''} ${statuses[i.id]==='reviewed'?'reviewed':''}" data-issue="${i.id}"><div class="issue-top"><span class="tag ${i.severity==='error'?'error':''}">${esc(i.category)}</span><span class="issue-status">${statuses[i.id]==='reviewed'?'✓ 확인 완료':'확인 필요'}</span></div><h3>${esc(i.title)}</h3><div class="issue-values">${esc([...new Set(i.evidence.map(e=>e.display))].join(' ↔ '))}</div><div class="issue-source">${icon('file')}문서 ${new Set(i.evidence.map(e=>e.documentId)).size}개 · 근거 ${i.evidence.length}곳</div></button>`).join('');
  document.querySelectorAll('[data-issue]').forEach(b=>b.onclick=()=>{selected=b.dataset.issue;renderResults();renderDetail();});
}
function bindSource(){document.querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>{const r=await window.moa.openSource(b.dataset.open);if(r.error)toast(r.error);});}
function evidenceHtml(e){return `<div class="evidence"><div class="evidence-top">${icon('file')}<span>${esc(e.fileName)}</span><button class="source-open" data-open="${esc(e.documentId)}">원본 열기 ↗</button></div><div class="evidence-value">${esc(e.display)}</div><div class="evidence-location">${icon('pin')}${esc(e.location)}</div><div class="excerpt">${esc(e.excerpt)}</div></div>`;}
function renderDetail(){
  const issue=report?.issues.find(i=>i.id===selected);
  if(!issue||busy){$('#detail').innerHTML=empty('검토 항목을 선택하세요','검토 항목을 선택하면\n문서별 값과 원문이 여기에 표시돼요.','file');return;}
  const reviewed=statuses[issue.id]==='reviewed';
  $('#detail').innerHTML=`<div class="detail-inner"><span class="tag ${reviewed?'reviewed':issue.severity==='error'?'error':''}">${esc(issue.category)} · ${reviewed?'확인 완료':'확인 필요'}</span><h2 class="detail-title">${esc(issue.title)}</h2><p class="detail-description">${esc(issue.description)}</p>${issue.evidence.map(evidenceHtml).join('')}<div class="detail-bottom"><button id="mark-reviewed" class="button ${reviewed?'secondary':'primary'}">${icon('check')}${reviewed?'확인 필요로 되돌리기':'확인 완료로 표시'}</button><p>검토 상태만 변경돼요. 원본 수정 후에는 다시 검사해 주세요.</p></div></div>`;
  $('#mark-reviewed').onclick=()=>{statuses[issue.id]=reviewed?'pending':'reviewed';if($('#pending-only').checked&&!reviewed)selected=visibleIssues()[0]?.id||null;render();};bindSource();
}
function showDocument(id){
  if(!report){toast('검사 후 파일에서 읽은 정보를 확인할 수 있어요.');return;}selected=null;renderResults();
  const doc=documents.find(d=>d.id===id);if(!doc){$('#detail').innerHTML=empty('문서를 읽지 못했어요','상단의 파일 읽기 오류를 확인해 주세요.','alert');return;}
  const facts=report.facts.filter(f=>f.documentId===id);
  $('#detail').innerHTML=`<div class="detail-inner"><span class="tag reviewed">읽은 정보</span><h2 class="detail-title">${esc(doc.name)}</h2><p class="detail-description">문단·행 ${doc.blocks.length}개에서 비교 항목 ${facts.length}개를 인식했어요. 화면에는 원본의 텍스트를 추출해 표시합니다.</p>${doc.warnings.map(w=>`<div class="excerpt">${esc(w)}</div>`).join('')}${facts.length?facts.map(evidenceHtml).join(''):doc.blocks.slice(0,40).map(b=>`<div class="evidence"><div class="evidence-location">${esc(b.location)}</div><div class="excerpt">${esc(b.text)}</div></div>`).join('')}</div>`;bindSource();
}
$('#scan').onclick=async()=>{
  if(busy)return;const year=Number($('#year').value);if(!Number.isInteger(year)||year<2000||year>2100){notice(['기준 연도는 2000~2100년 사이로 입력해 주세요.']);return;}
  notice([]);setBusy(true);render();
  try{
    const r=await window.moa.scan(files.map(f=>f.id),year);if(r.error)throw new Error(r.error);
    report=r.report;documents=r.documents;statuses={};selected=visibleIssues()[0]?.id||null;
    const warnings=r.errors.map(e=>`${e.name}: ${e.message}`);documents.forEach(d=>d.warnings.forEach(w=>warnings.push(`${d.name}: ${w}`)));notice(warnings);
    $('#coverage-note').hidden=false;$('#coverage-note').innerHTML=`<b>${report.documents.length}개 문서 · ${report.facts.length}개 항목 인식</b><br>인식한 항목을 비교한 결과입니다. 파일명을 누르면 읽은 내용을 볼 수 있습니다.`;
    toast(`${report.documents.length}개 문서에서 확인할 항목 ${report.issues.length}개를 찾았어요.`);
  }catch(e){report=null;documents=[];selected=null;notice([e.message]);$('#coverage-note').hidden=true;}
  finally{setBusy(false);render();}
};
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));selected=visibleIssues()[0]?.id||null;renderResults();renderDetail();});
$('#search').oninput=()=>{selected=visibleIssues()[0]?.id||null;renderResults();renderDetail();};$('#pending-only').onchange=()=>{selected=visibleIssues()[0]?.id||null;renderResults();renderDetail();};
function page(guide){$('#review-page').hidden=guide;$('#guide-page').hidden=!guide;$('#nav-guide').classList.toggle('active',guide);$('#nav-review').classList.toggle('active',!guide);$('#page-label').textContent=guide?'사용 안내':'문서 검토';}
$('#nav-review').onclick=()=>page(false);$('#nav-guide').onclick=()=>page(true);$('.brand').onclick=e=>{e.preventDefault();page(false);};
$('#new-task').onclick=()=>{if(busy)return;if(files.length)$('#reset-dialog').showModal();else page(false);};
$('#reset-cancel').onclick=()=>$('#reset-dialog').close();$('#reset-confirm').onclick=()=>{files=[];filter='all';$('#search').value='';$('#pending-only').checked=false;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter==='all'));invalidate();notice([]);page(false);$('#reset-dialog').close();};
$('#export').onclick=()=>$('#export-dialog').showModal();for(const type of ['html','csv'])$('#export-'+type).onclick=async()=>{$('#export-dialog').close();const r=await window.moa.exportReport(type,statuses);if(r.error)toast(r.error);else if(r.ok)toast(`저장했어요: ${r.path}`);};
$('#save-samples').onclick=async()=>{const r=await window.moa.exportSamples();if(r.error)toast(r.error);else if(r.ok)toast(`예제를 저장했어요: ${r.path}`);};
$('#minimize').onclick=()=>window.moa.minimize();$('#maximize').onclick=()=>window.moa.maximize();$('#close').onclick=()=>window.moa.close();
render();
