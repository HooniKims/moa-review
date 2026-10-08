'use strict';

const RELEASE_REPOSITORY = Object.freeze({owner:'HooniKims',repo:'moa-review'});
const RELEASE_URL = `https://github.com/${RELEASE_REPOSITORY.owner}/${RELEASE_REPOSITORY.repo}/releases/latest`;
function isNewer(candidate,current) {
  const parse=v=>/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(v));
  const a=parse(candidate),b=parse(current);
  if(!a||!b)return false;
  for(let i=1;i<=3;i++)if(Number(a[i])!==Number(b[i]))return Number(a[i])>Number(b[i]);
  return false;
}
function createUpdater({app,isInstalled,loadAutoUpdater,onChange=()=>{},fetchRelease=globalThis.fetch,now=Date.now}) {
  const mode=!app.isPackaged?'development':isInstalled?'installed':'zip';
  let state={mode,phase:mode==='development'?'disabled':'idle',current:app.getVersion(),available:null,progress:0,message:mode==='development'?'개발 실행에서는 업데이트를 확인하지 않습니다.':'새 버전이 있는지 확인할 수 있습니다.',releaseUrl:RELEASE_URL};
  let updater,checking,timer,interval;
  const snapshot=()=>({...state});
  function set(patch){state={...state,...patch};onChange(snapshot());}
  function fail(error){set({phase:'error',progress:0,message:/404|latest\.yml|No published versions|Cannot find latest/i.test(String(error?.message))?'배포된 업데이트 정보를 찾지 못했습니다. 잠시 뒤 다시 확인해 주세요.':'업데이트를 확인하거나 내려받지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.'});}
  function engine(){
    if(updater)return updater;
    updater=loadAutoUpdater();
    updater.autoDownload=false;
    updater.autoInstallOnAppQuit=false;
    updater.allowPrerelease=false;
    updater.allowDowngrade=false;
    updater.logger=null;
    // Same hidden-launch fix used by EduDock: no console flashes during updates.
    if(typeof updater.spawnLog==='function')updater.spawnLog=(cmd,args=[],env,stdio='ignore')=>new Promise((resolve,reject)=>{
      const child=require('node:child_process').spawn(cmd,args,{env,stdio,detached:true,windowsHide:true});
      child.once('error',reject);child.once('spawn',()=>{child.unref();resolve(true);});
    });
    updater.on('checking-for-update',()=>set({phase:'checking',message:'새 버전을 확인하고 있습니다.'}));
    updater.on('update-not-available',()=>set({phase:'latest',available:null,checkedAt:now(),message:'최신 버전입니다.'}));
    updater.on('update-available',info=>set({phase:'available',available:info.version,progress:0,checkedAt:now(),message:`새 버전 ${info.version}을 내려받을 수 있습니다.`}));
    updater.on('download-progress',info=>set({phase:'downloading',progress:Math.max(0,Math.min(100,Math.round(info.percent||0)))}));
    updater.on('update-downloaded',info=>set({phase:'ready',available:info.version,progress:100,message:'다운로드가 끝났습니다. 검토 결과를 저장한 뒤 재시작해 주세요.'}));
    updater.on('error',fail);
    return updater;
  }
  function check(){
    if(mode==='development'||['downloading','ready','installing'].includes(state.phase))return Promise.resolve(snapshot());
    if(checking)return checking;
    // Defer invocation so synchronous provider errors and concurrent clicks share one promise.
    checking=Promise.resolve().then(async()=>{
      set({phase:'checking',message:'새 버전을 확인하고 있습니다.'});
      if(mode==='installed')await engine().checkForUpdates();
      else {
        const response=await fetchRelease(`https://api.github.com/repos/${RELEASE_REPOSITORY.owner}/${RELEASE_REPOSITORY.repo}/releases/latest`,{headers:{Accept:'application/vnd.github+json','User-Agent':'MoaReview'},signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const release=await response.json();
        if(release.draft||release.prerelease)throw new Error('No published versions');
        const available=String(release.tag_name||'').replace(/^v/,'');
        if(!/^\d+\.\d+\.\d+$/.test(available))throw new Error('Invalid release version');
        set(isNewer(available,state.current)?{phase:'available',available,checkedAt:now(),message:`새 버전 ${available}이 있습니다. 릴리즈 페이지에서 ZIP 파일을 내려받아 교체하세요.`}:{phase:'latest',available:null,checkedAt:now(),message:'최신 버전입니다.'});
      }
    }).catch(fail).then(snapshot).finally(()=>{checking=null;});
    return checking;
  }
  async function download(){
    if(mode!=='installed'||state.phase!=='available')return snapshot();
    set({phase:'downloading',progress:0,message:'업데이트를 내려받고 있습니다. 문서 검토는 계속할 수 있습니다.'});
    try{await engine().downloadUpdate();}catch(error){fail(error);}
    return snapshot();
  }
  function install(){
    if(mode!=='installed'||state.phase!=='ready')return false;
    set({phase:'installing',message:'업데이트를 설치한 뒤 다시 실행합니다.'});
    setImmediate(()=>{try{updater.quitAndInstall(true,true);}catch(error){fail(error);}});
    return true;
  }
  function stop(){clearTimeout(timer);clearInterval(interval);timer=null;interval=null;}
  function start(){
    if(mode==='development'||timer||interval)return;
    timer=setTimeout(()=>void check(),15000);interval=setInterval(()=>void check(),4*60*60*1000);
    timer.unref?.();interval.unref?.();
  }
  return {check,download,install,start,stop,get state(){return snapshot();}};
}
module.exports={createUpdater,isNewer,RELEASE_REPOSITORY,RELEASE_URL};
