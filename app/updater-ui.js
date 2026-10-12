(()=>{
  const BUILD_TAG='1a07766b3ac2';
  const el=id=>document.getElementById(id);let state,acting=false;
  function render(value){
    if(!value||value.error)return;
    state=value;
    el('app-version').textContent=value.current;
    el('update-version').textContent=`현재 버전 ${value.current}${value.available?' · 새 버전 '+value.available:''}`;
    el('update-message').textContent=value.message;
    el('update-dot').hidden=!['available','ready'].includes(value.phase);
    const downloading=value.phase==='downloading';
    el('update-progress').hidden=!downloading;el('update-progress').value=value.progress;
    const labels={disabled:'개발 실행',checking:'확인 중…',downloading:`다운로드 ${value.progress}%`,installing:'설치 중…',ready:'재시작하여 설치',available:value.mode==='zip'?'새 ZIP 받기':'업데이트 받기'};
    el('update-action').textContent=labels[value.phase]||'새 버전 확인';
    el('update-action').disabled=acting||['disabled','checking','downloading','installing'].includes(value.phase);
  }
  const openSettings=async()=>{el('update-dialog').showModal();render(await window.moa.updateState());};
  el('open-settings').onclick=openSettings;
  el('open-update').onclick=openSettings;
  el('update-release').onclick=()=>window.moa.openRelease();
  el('license-toggle').onclick=async()=>{
    const box=el('license-text');
    if(!box.textContent){const text=await window.moa.licenseText().catch(()=>'');box.textContent=typeof text==='string'&&text?text:'이용약관을 불러오지 못했습니다. 설치 폴더의 LICENSE.txt를 확인해 주세요.';}
    box.hidden=!box.hidden;el('license-toggle').textContent=box.hidden?'이용약관 보기':'이용약관 닫기';el('license-toggle').setAttribute('aria-expanded',String(!box.hidden));
  };
  el('update-action').onclick=async()=>{
    if(!state||acting)return;acting=true;render(state);
    let errorMessage;
    try{
      const result=await (state.phase==='ready'?window.moa.installUpdate():state.phase==='available'?(state.mode==='zip'?window.moa.openRelease():window.moa.downloadUpdate()):window.moa.checkUpdate());
      render(await window.moa.updateState());
      if(result?.error)errorMessage=result.error;
    }catch{errorMessage='업데이트 요청을 처리하지 못했습니다. 다시 시도해 주세요.';}
    finally{acting=false;if(state)render(state);if(errorMessage)el('update-message').textContent=errorMessage;}
  };
  window.moa.onUpdate(render);window.moa.updateState().then(render).catch(()=>{});
})();
