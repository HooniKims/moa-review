const {app,BrowserWindow,ipcMain,dialog,shell,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const {reportHtml,reportCsv}=require('../src/report.cjs');
const {createUpdater,RELEASE_URL}=require('./updater.cjs');
const {saveCopy}=require('../src/edit-storage.cjs');
let win,lastReport,activeWorker,demoDirectory,updater,lastDocuments=[],pendingEdit,editSaving=false;const registered=new Map();
if(process.env.MOA_TEST_DATA)app.setPath('userData',process.env.MOA_TEST_DATA);
const safe=fn=>async(event,...args)=>{
  if(event.sender!==win?.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('허용되지 않은 요청입니다.');
  try{return await fn(...args);}catch(e){return {error:e.message||'작업을 완료하지 못했습니다.'};}
};
async function copySamples(destination) {
  const source=path.join(__dirname,'../assets/samples');
  for(const name of (await fs.readdir(source)).filter(n=>/\.(hwpx|xlsx)$/i.test(n))) {
    // Read through Electron's ASAR support; fs.cp and external apps need real files.
    await fs.writeFile(path.join(destination,name),await fs.readFile(path.join(source,name)),{flag:'wx'});
  }
  return destination;
}
async function register(paths) {
  const files=[],errors=[];
  if(!Array.isArray(paths)||paths.length>30)throw new Error('한 번에 최대 30개 파일을 추가할 수 있습니다.');
  for(const p of paths) {
    if(typeof p!=='string'||!path.isAbsolute(p))continue;
    const name=path.basename(p),extension=path.extname(p).toLowerCase();
    if(!['.hwpx','.xlsx'].includes(extension)){errors.push(`${name}: HWPX·XLSX만 지원합니다.`);continue;}
    try {const stat=await fs.stat(p);if(!stat.isFile()||stat.size>50*1024*1024)throw new Error('50MB 이하 파일만 지원합니다.');
      const id=crypto.createHash('sha256').update(p).digest('hex').slice(0,16);registered.set(id,p);files.push({id,name,type:extension.slice(1).toUpperCase(),size:stat.size});
    }catch(e){errors.push(`${name}: ${e.message}`);}
  }
  return {files,errors};
}
function scan(paths,year){return new Promise((resolve,reject)=>{
  const w=new Worker(path.join(__dirname,'worker.cjs'),{workerData:{paths,year},resourceLimits:{maxOldGenerationSizeMb:384}});activeWorker=w;
  const timer=setTimeout(()=>{w.terminate();reject(new Error('검사 시간이 60초를 초과했습니다. 파일 수나 크기를 줄여 주세요.'));},60000);
  w.once('message',r=>{clearTimeout(timer);if(activeWorker===w)activeWorker=null;r.ok?resolve(r):reject(new Error(r.error));});
  w.once('error',e=>{clearTimeout(timer);if(activeWorker===w)activeWorker=null;reject(e);});
  w.once('exit',code=>{clearTimeout(timer);if(activeWorker===w)activeWorker=null;if(code!==0)reject(new Error('검사를 마치지 못했습니다. 파일을 나누어 다시 검사해 주세요.'));});
});}
function editTask(action,data){return new Promise((resolve,reject)=>{
  if(activeWorker)return reject(new Error('현재 작업이 끝난 뒤 수정해 주세요.'));
  const worker=new Worker(path.join(__dirname,'edit-worker.cjs'),{workerData:{action,...data},resourceLimits:{maxOldGenerationSizeMb:512}});activeWorker=worker;
  const clear=()=>{clearTimeout(timer);if(activeWorker===worker)activeWorker=null;};
  const timer=setTimeout(()=>{worker.terminate();clear();reject(new Error('수정 처리 시간이 초과되었습니다. 원본 프로그램에서 수정해 주세요.'));},60000);
  worker.once('message',r=>{clear();r.ok?resolve(r):reject(new Error(r.error));});
  worker.once('error',e=>{clear();reject(e);});
  worker.once('exit',code=>{clear();if(code!==0)reject(new Error('문서 수정 작업을 마치지 못했습니다.'));});
});}
app.whenReady().then(()=>{
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,callback)=>callback({cancel:true}));
  win=new BrowserWindow({width:1440,height:960,minWidth:1100,minHeight:740,show:false,frame:false,backgroundColor:'#F5F6F2',icon:path.join(__dirname,'../assets/icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,devTools:!app.isPackaged}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  win.loadFile(path.join(__dirname,'index.html'));
  win.once('ready-to-show',()=>{if(!process.env.MOA_TEST_HIDDEN)win.show();});
  updater=createUpdater({app,isInstalled:require('node:fs').existsSync(path.join(path.dirname(app.getPath('exe')),'Uninstall MoaReview.exe')),loadAutoUpdater:()=>require('electron-updater').autoUpdater,onChange:state=>{if(!win.isDestroyed())win.webContents.send('update:state',state);}});
  ipcMain.handle('update:state',safe(()=>updater.state));
  ipcMain.handle('update:check',safe(()=>updater.check()));
  ipcMain.handle('update:download',safe(()=>updater.download()));
  ipcMain.handle('update:release',safe(async()=>{await shell.openExternal(RELEASE_URL);return {ok:true};}));
  ipcMain.handle('update:install',safe(async()=>{
    if(activeWorker||editSaving)throw new Error('현재 작업이 끝난 뒤 업데이트를 설치해 주세요.');
    if(updater.state.phase!=='ready')return {ok:false};
    const result=await dialog.showMessageBox(win,{type:'question',title:'업데이트 설치',message:'모아검토를 재시작할까요?',detail:'현재 파일 목록과 확인 표시는 재시작하면 사라집니다. 필요한 검토 결과를 먼저 저장해 주세요.',buttons:['돌아가기','재시작하여 설치'],defaultId:0,cancelId:0,noLink:true});
    return {ok:result.response===1&&updater.install()};
  }));
  if(!process.env.MOA_TEST_DATA)updater.start();
  ipcMain.handle('files:select',safe(async()=>{const r=await dialog.showOpenDialog(win,{title:'함께 검사할 문서 선택',properties:['openFile','multiSelections'],filters:[{name:'학교 문서',extensions:['hwpx','xlsx']}]});return r.canceled?{files:[],errors:[]}:register(r.filePaths);}));
  ipcMain.handle('files:add',safe(register));
  ipcMain.handle('files:demo',safe(async()=>{
    if(!demoDirectory)demoDirectory=await copySamples(await fs.mkdtemp(path.join(app.getPath('temp'),'moa-samples-')));
    return register((await fs.readdir(demoDirectory)).filter(n=>/\.(hwpx|xlsx)$/i.test(n)).map(n=>path.join(demoDirectory,n)));
  }));
  ipcMain.handle('scan',safe(async(ids,year)=>{
    if(activeWorker||editSaving)throw new Error('다른 작업이 진행 중입니다.');
    if(!Array.isArray(ids)||!ids.length||ids.length>30||!ids.every(id=>registered.has(id)))throw new Error('검사할 파일을 다시 선택해 주세요.');
    if(!Number.isInteger(year)||year<2000||year>2100)throw new Error('기준 연도를 확인해 주세요.');
    pendingEdit=null;lastDocuments=[];lastReport=null;const r=await scan([...new Set(ids)].map(id=>registered.get(id)),year);lastReport=r.report;lastDocuments=r.documents;return r;
  }));
  ipcMain.handle('document:prepare-edit',safe(async(id,location)=>{
    if(activeWorker||editSaving)throw new Error('현재 작업이 끝난 뒤 수정해 주세요.');
    pendingEdit=null;
    const document=lastDocuments.find(d=>d.id===id&&registered.get(id)===d.path);
    const matches=document?.blocks.flatMap(b=>b.cells||[b]).filter(b=>b.location===location&&b.source)||[];
    if(matches.length!==1)throw new Error('수정할 원문 위치를 확인할 수 없습니다. 다시 검사해 주세요.');
    const context={id,filePath:document.path,source:matches[0].source,expectedHash:document.sha256};
    const result=await editTask('prepare',context);
    const token=crypto.randomUUID();pendingEdit={...context,token};
    return {...result,token,fileName:document.name,location};
  }));
  ipcMain.handle('document:save-edit',safe(async(token,text)=>{
    if(activeWorker||editSaving)throw new Error('현재 작업이 끝난 뒤 저장해 주세요.');
    if(!pendingEdit||pendingEdit.token!==token)throw new Error('수정할 내용을 다시 열어 주세요.');
    if(typeof text!=='string'||text.length>10000)throw new Error('수정할 내용을 확인해 주세요.');
    const edit=pendingEdit;editSaving=true;
    try{
      const ext=path.extname(edit.filePath),stem=path.basename(edit.filePath,ext).replace(/_수정본(?:_\d+)?$/,'');
      const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14);
      const destination=await dialog.showSaveDialog(win,{title:'수정본 저장',defaultPath:path.join(path.dirname(edit.filePath),`${stem}_수정본_${stamp}${ext}`),filters:[{name:ext.slice(1).toUpperCase(),extensions:[ext.slice(1)]}]});
      if(destination.canceled)return {canceled:true};
      const result=await editTask('apply',{...edit,text});
      const saved=await saveCopy(destination.filePath,edit.filePath,[...registered.values()],result.buffer);
      const registeredResult=await register([saved]);
      if(!registeredResult.files.length)throw new Error(`수정본을 저장했지만 다시 불러오지 못했습니다: ${saved}`);
      pendingEdit=null;lastReport=null;lastDocuments=[];
      return {ok:true,path:saved,file:registeredResult.files[0],recalculate:result.recalculate,stalePreview:result.stalePreview};
    }finally{editSaving=false;}
  }));
  ipcMain.handle('source:open',safe(async id=>{const p=registered.get(id);if(!p)throw new Error('파일을 다시 추가해 주세요.');const err=await shell.openPath(p);if(err)throw new Error('원본을 열 수 없습니다. 한글 또는 엑셀 연결 프로그램을 확인해 주세요.');return {ok:true};}));
  ipcMain.handle('report:export',safe(async(type,statuses)=>{
    if(!lastReport)throw new Error('먼저 검사를 실행해 주세요.');
    if(!['html','csv'].includes(type))throw new Error('지원하지 않는 형식입니다.');
    const report=structuredClone(lastReport);report.issues.forEach(i=>{i.status=statuses?.[i.id]==='reviewed'?'reviewed':'pending';});
    const r=await dialog.showSaveDialog(win,{title:'검사 결과 저장',defaultPath:`모아검토_${report.year}_${new Date().toISOString().slice(0,10)}.${type}`,filters:[{name:type==='html'?'웹 문서':'CSV (엑셀에서 열기)',extensions:[type]}]});
    if(r.canceled)return {canceled:true};
    // 입력 원본을 출력 대상으로 선택해도 덮어쓰지 않음
    if(!r.filePath.toLowerCase().endsWith('.'+type))throw new Error(`.${type} 확장자로 저장해 주세요.`);
    await fs.writeFile(r.filePath,type==='html'?reportHtml(report):reportCsv(report),'utf8');return {ok:true,path:r.filePath};
  }));
  ipcMain.handle('samples:export',safe(async()=>{
    const r=await dialog.showOpenDialog(win,{title:'예제 파일을 저장할 폴더',properties:['openDirectory','createDirectory']});if(r.canceled)return {canceled:true};
    const destination=await fs.mkdtemp(path.join(r.filePaths[0],'모아검토_예제_'));await copySamples(destination);return {ok:true,path:destination};
  }));
  for(const [channel,fn] of Object.entries({'window:minimize':()=>win.minimize(),'window:maximize':()=>win.isMaximized()?win.unmaximize():win.maximize(),'window:close':()=>win.close()}))ipcMain.on(channel,e=>{if(e.sender===win.webContents)fn();});
});
app.on('window-all-closed',()=>{activeWorker?.terminate();app.quit();});
app.on('before-quit',()=>updater?.stop());
