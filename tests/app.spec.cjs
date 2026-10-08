const {test,expect,_electron}=require('@playwright/test');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
let electronApp,page,temp,errors;
test.beforeEach(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'moa-ui-'));
  const env={...process.env,MOA_TEST_DATA:path.join(temp,'profile'),MOA_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  electronApp=await _electron.launch({...(process.env.MOA_PACKAGED_EXE?{executablePath:process.env.MOA_PACKAGED_EXE,args:[]}:{args:[path.resolve(__dirname,'..')]}),env});
  page=await electronApp.firstWindow();errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('domcontentloaded');
  await electronApp.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setBackgroundThrottling(false);w.showInactive();});
});
test.afterEach(async()=>{if(electronApp)await electronApp.close();expect(errors).toEqual([]);});
async function demoScan(){await page.locator('#demo').click();await expect(page.locator('.file-item')).toHaveCount(3);await expect(page.locator('[data-stage="scan"]')).toHaveAttribute('aria-current','step');await page.locator('#scan').click();await expect(page.locator('#scan-status')).toHaveText('검사가 끝났어요');await expect(page.locator('[data-stage="review"]')).toHaveAttribute('aria-current','step');await expect(page.locator('.issue-card')).toHaveCount(6);}
async function screenshot(target){await page.screenshot({path:target,animations:'disabled'});}

test('update dialog shows current version and receives download progress',async()=>{
  await page.locator('#open-settings').click();await expect(page.locator('#update-dialog')).toBeVisible();
  await expect(page.locator('.maker-credit')).toContainText('HooniKim');await screenshot('docs/screenshot-settings.png');
  await page.keyboard.press('Escape');await page.locator('#open-update').click();await expect(page.locator('#update-dialog')).toBeVisible();
  await expect(page.locator('#update-version')).toContainText(require('../package.json').version);
  await electronApp.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('update:state',{mode:'installed',phase:'available',current:'1.1.0',available:'1.2.0',progress:0,message:'새 버전 1.2.0을 내려받을 수 있습니다.'}));
  await expect(page.locator('#update-action')).toHaveText('업데이트 받기');await expect(page.locator('#update-dot')).toBeVisible();
  await electronApp.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('update:state',{mode:'installed',phase:'downloading',current:'1.1.0',available:'1.2.0',progress:43,message:'업데이트를 내려받고 있습니다.'}));
  await expect(page.locator('#update-action')).toBeDisabled();await expect(page.locator('#update-progress')).toHaveAttribute('value','43');
  await electronApp.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('update:state',{mode:'installed',phase:'ready',current:'1.1.0',available:'1.2.0',progress:100,message:'검토 결과를 저장한 뒤 재시작해 주세요.'}));
  await expect(page.locator('#update-action')).toHaveText('재시작하여 설치');await expect(page.locator('#update-action')).toBeEnabled();
  await screenshot('docs/screenshot-update.png');await page.keyboard.press('Escape');await expect(page.locator('#update-dialog')).not.toBeVisible();
});
test('complete workflow: font, demo, filters, evidence, reviewed state, exports and reset',async()=>{
  await expect(page.locator('h1').first()).toHaveText('문서 대조');
  await expect(page.locator('[data-stage="add"]')).toHaveAttribute('aria-current','step');
  await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.fonts.check('14px Pretendard'))).toBe(true);
  const fontSession=await page.context().newCDPSession(page);await fontSession.send('DOM.enable');await fontSession.send('CSS.enable');
  const {root:fontRoot}=await fontSession.send('DOM.getDocument');
  for(const selector of ['h1','.heading-row p']){
    const {nodeId}=await fontSession.send('DOM.querySelector',{nodeId:fontRoot.nodeId,selector});
    const {fonts}=await fontSession.send('CSS.getPlatformFontsForNode',{nodeId});
    expect(fonts.length).toBeGreaterThan(0);expect(fonts.every(f=>f.isCustomFont&&f.familyName.includes('Pretendard'))).toBe(true);
  }
  await fontSession.detach();
  await screenshot('docs/screenshot-home.png');
  await demoScan();await expect(page.locator('#pending-count')).toHaveText('6');
  await page.locator('[data-filter="people"]').click();await expect(page.locator('.issue-card')).toHaveCount(1);await expect(page.locator('#detail')).toContainText('118명');await expect(page.locator('#detail')).toContainText('120명');await expect(page.locator('#detail')).toContainText('체험학습 예산!B3');
  await screenshot('docs/screenshot-review.png');
  await page.locator('#mark-reviewed').click();await expect(page.locator('#reviewed-count')).toHaveText('1');await page.locator('#pending-only').check();await expect(page.locator('.issue-card')).toHaveCount(0);
  await page.locator('#pending-only').uncheck();await page.locator('[data-filter="all"]').click();await page.locator('#search').fill('수량');await expect(page.locator('.issue-card')).toHaveCount(1);await page.locator('#search').fill('');
  for(const type of ['html','csv']){
    const target=path.join(temp,'result.'+type);await electronApp.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);
    await page.locator('#export').click();await page.locator('#export-'+type).click();await expect(page.locator('#toast')).toContainText('저장했어요');const output=await fs.readFile(target,'utf8');expect(output).toContain('확인 완료');expect(output).toContain('118명');
  }
  await page.locator('.file-name').first().click();await expect(page.locator('#detail')).toContainText('읽은 정보');
  await page.locator('#nav-guide').click();await expect(page.locator('#guide-page')).toBeVisible();await expect(page.locator('.workflow')).toBeHidden();await screenshot('docs/screenshot-guide.png');await page.locator('#nav-review').click();await expect(page.locator('.workflow')).toBeVisible();
  await page.locator('#new-task').click();await page.locator('#reset-cancel').click();await expect(page.locator('.file-item')).toHaveCount(3);await page.locator('#new-task').click();await page.locator('#reset-confirm').click();await expect(page.locator('#empty-view')).toBeVisible();
});
test('file selection cancellation, unsupported/corrupt files, removal and recovery',async()=>{
  await electronApp.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});await page.locator('#pick-empty').click();await expect(page.locator('#empty-view')).toBeVisible();
  const bad=path.join(temp,'손상된 문서.hwpx'),unsupported=path.join(temp,'old.hwp');await fs.writeFile(bad,'not a zip');await fs.writeFile(unsupported,'old');
  await electronApp.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},[bad,unsupported]);
  await page.locator('#pick-empty').click();await expect(page.locator('#notice')).toContainText('HWPX·XLSX만 지원');await page.locator('#scan').click();await expect(page.locator('#notice')).toContainText('손상');await expect(page.locator('#result-list')).toContainText('인식한 비교 항목이 없어요');
  await page.locator('.file-remove').click();await expect(page.locator('#empty-view')).toBeVisible();await demoScan();
});
test('minimum window layout, validation, keyboard navigation and safe source opening',async()=>{
  await electronApp.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,740));
  await page.emulateMedia({reducedMotion:'reduce'});
  const home=await page.locator('#empty-view').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,button:document.querySelector('#pick-empty').getBoundingClientRect().bottom,height:innerHeight}));expect(home.scroll).toBeLessThanOrEqual(home.width);expect(home.button).toBeLessThan(home.height);
  await screenshot('docs/screenshot-home-compact.png');await demoScan();
  const sizes=await page.evaluate(()=>({w:innerWidth,h:innerHeight,body:document.body.scrollWidth,panels:[...document.querySelectorAll('.work-grid>.panel')].map(e=>({w:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,bottom:e.getBoundingClientRect().bottom}))}));expect(sizes.body).toBeLessThanOrEqual(sizes.w);expect(sizes.panels.every(p=>p.w>150&&p.right<=sizes.w&&p.bottom<=sizes.h)).toBe(true);
  await screenshot('docs/screenshot-compact.png');
  await electronApp.evaluate(({shell})=>{shell.openPath=async()=> 'No application';});await page.locator('[data-open]').first().click();await expect(page.locator('#toast')).toContainText('연결 프로그램');
  await page.locator('#year').fill('1999');await page.locator('#scan').click();await expect(page.locator('#notice')).toContainText('2000~2100');
  await page.locator('#year').fill('2026');await page.locator('#scan').click();await expect(page.locator('.issue-card')).toHaveCount(6);
  await page.locator('#export').click();await page.keyboard.press('Escape');await expect(page.locator('#export-dialog')).not.toBeVisible();
});
test('duplicate import does not multiply files, re-scan resets reviewed markers',async()=>{
  await demoScan();await page.locator('#mark-reviewed').click();await expect(page.locator('#reviewed-count')).toHaveText('1');await page.locator('#scan').click();await expect(page.locator('#reviewed-count')).toHaveText('0');await page.locator('#demo').click();await expect(page.locator('.file-item')).toHaveCount(3);await expect(page.locator('#export')).toBeDisabled();
});

test('packaged sample export writes usable original files',async()=>{
  await electronApp.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},temp);
  await page.locator('#nav-guide').click();await page.locator('#save-samples').click();
  await expect(page.locator('#toast')).toContainText('예제를 저장했어요');
  const folder=(await fs.readdir(temp)).find(n=>n.startsWith('모아검토_예제_'));
  const names=await fs.readdir(path.join(temp,folder));expect(names).toHaveLength(3);
  for(const name of names)expect(await fs.readFile(path.join(temp,folder,name))).toEqual(await fs.readFile(path.join(__dirname,'../assets/samples',name)));
  await page.locator('#nav-review').click();await demoScan();
  await electronApp.evaluate(({shell})=>{shell.openPath=async file=>{globalThis.lastOpenedSource=file;return '';};});
  await page.locator('[data-open]').first().click();
  const opened=await electronApp.evaluate(()=>globalThis.lastOpenedSource);
  expect(opened).not.toContain('app.asar');expect((await fs.stat(opened)).isFile()).toBe(true);
});

test('re-scan keeps detail selection consistent with active filter and search',async()=>{
  await demoScan();await page.locator('[data-filter="people"]').click();
  await page.locator('#scan').click();await expect(page.locator('#scan-status')).toHaveText('검사가 끝났어요');
  await expect(page.locator('.issue-card.selected')).toHaveCount(1);await expect(page.locator('#detail')).toContainText('118명');
  await page.locator('#search').fill('없는검색어');await page.locator('#scan').click();
  await expect(page.locator('#scan-status')).toHaveText('검사가 끝났어요');await expect(page.locator('#mark-reviewed')).toHaveCount(0);
});

test('exports preserve failed-file warnings when no documents can be read',async()=>{
  const bad=path.join(temp,'검사실패.hwpx');await fs.writeFile(bad,'bad archive');
  await electronApp.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},bad);
  await page.locator('#pick-empty').click();await page.locator('#scan').click();await expect(page.locator('#scan-status')).toHaveText('검사가 끝났어요');
  for(const type of ['html','csv']){
    const target=path.join(temp,'failed.'+type);await electronApp.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},target);
    await page.locator('#export').click();await page.locator('#export-'+type).click();await expect(page.locator('#toast')).toContainText('저장했어요');
    const saved=await fs.readFile(target,'utf8');expect(saved).toContain('검사실패.hwpx');expect(saved).toContain('손상');
  }
});

test('real dropped files, partial read failure, export cancellation and original protection',async()=>{
  const samples=path.join(__dirname,'../assets/samples');const names=await fs.readdir(samples);
  const inputs=[];for(const name of names){const target=path.join(temp,name);await fs.copyFile(path.join(samples,name),target);inputs.push(target);}
  const original=await fs.readFile(inputs[0]);const bad=path.join(temp,'추가손상.xlsx');await fs.writeFile(bad,'bad');inputs.push(bad);
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.multiple=true;input.id='test-file-drop';input.hidden=true;document.body.append(input);});
  // CDP supplies disk-backed Files, preserving the native path used by webUtils.
  const cdp=await page.context().newCDPSession(page);const {root}=await cdp.send('DOM.getDocument');
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#test-file-drop'});
  await cdp.send('DOM.setFileInputFiles',{nodeId,files:inputs});
  await page.evaluate(()=>{const data=new DataTransfer();for(const file of document.querySelector('#test-file-drop').files)data.items.add(file);window.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));});
  await expect(page.locator('.file-item')).toHaveCount(4);await page.locator('#year').fill('2026');await page.locator('#scan').click();
  await expect(page.locator('#scan-status')).toHaveText('검사가 끝났어요');await expect(page.locator('.issue-card')).toHaveCount(6);await expect(page.locator('#notice')).toContainText('추가손상.xlsx');
  await electronApp.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});
  await page.locator('#export').click();await page.locator('#export-html').click();await expect(page.locator('#export-dialog')).not.toBeVisible();
  await electronApp.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},inputs[0]);
  await page.locator('#export').click();await page.locator('#export-html').click();await expect(page.locator('#toast')).toContainText('.html 확장자');expect(await fs.readFile(inputs[0])).toEqual(original);
  for(const type of ['html','csv']){
    const output=path.join(temp,'partial.'+type);await electronApp.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    await page.locator('#export').click();await page.locator('#export-'+type).click();await expect(page.locator('#toast')).toContainText(output);
    const saved=await fs.readFile(output,'utf8');expect(saved).toContain('추가손상.xlsx');expect(saved).toContain('118명');expect(saved).toContain('파일 읽기 실패');
  }
});

test('missing input and failed save recover without losing review state',async()=>{
  await demoScan();await page.locator('#mark-reviewed').click();
  const destination=path.join(temp,'missing-folder','report.html');await electronApp.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},destination);
  await page.locator('#export').click();await page.locator('#export-html').click();await expect(page.locator('#toast')).toContainText('ENOENT');await expect(page.locator('#reviewed-count')).toHaveText('1');
  const sample=(await fs.readdir(path.join(__dirname,'../assets/samples')))[0],missing=path.join(temp,sample);
  await fs.copyFile(path.join(__dirname,'../assets/samples',sample),missing);
  await electronApp.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},missing);
  await page.locator('#pick-more').click();await expect(page.locator('.file-item')).toHaveCount(4);await fs.unlink(missing);
  await page.locator('#scan').click();await expect(page.locator('#scan-status')).toHaveText('검사가 끝났어요');await expect(page.locator('#notice')).toContainText('ENOENT');await expect(page.locator('.issue-card')).toHaveCount(6);
});

test('direct edits save HWPX and XLSX copies and re-scan without changing originals',async()=>{
  await electronApp.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,740));
  await demoScan();await page.locator('[data-filter="people"]').click();
  const snapshot=await page.evaluate(()=>window.moa.scan([...document.querySelectorAll('[data-file]')].map(e=>e.dataset.file),2026));
  const originals=await Promise.all(snapshot.documents.map(async d=>({path:d.path,bytes:await fs.readFile(d.path)})));
  for(const extension of ['hwpx','xlsx']){
    const edit=extension==='hwpx'?page.locator('[data-edit]').nth(1):page.locator('[data-edit][data-location$="!B3"]');
    await edit.click();await expect(page.locator('#edit-fields')).toBeVisible();await expect(page.locator('#edit-save')).toBeDisabled();
    await page.locator('#edit-text').fill(extension==='hwpx'?'참가 인원: 118명':'118');
    const target=path.join(temp,'수정본.'+extension);await electronApp.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},target);
    if(extension==='hwpx'){await screenshot('docs/screenshot-edit.png');const bounds=await page.locator('#edit-save').boundingBox();expect(bounds.y+bounds.height).toBeLessThanOrEqual(740);}
    await page.locator('#edit-save').click();await expect(page.locator('#edit-dialog')).not.toBeVisible();await expect(page.locator('#scan-status')).toHaveText('검사가 끝났어요');
    const {parseDocument}=require('../src/documents.cjs');const parsed=parseDocument(await fs.readFile(target),target);expect(parsed.blocks.some(b=>b.text.includes('118'))).toBe(true);
    await expect(page.locator('.file-name').filter({hasText:'수정본.'+extension})).toHaveCount(1);
  }
  await expect(page.locator('.issue-card')).toHaveCount(0);
  for(const original of originals)expect(await fs.readFile(original.path)).toEqual(original.bytes);
});

test('direct editing cancellation, changed source and original overwrite are safe',async()=>{
  await demoScan();await page.locator('[data-filter="people"]').click();
  const snapshot=await page.evaluate(()=>window.moa.scan([...document.querySelectorAll('[data-file]')].map(e=>e.dataset.file),2026));
  const original=snapshot.documents[0],before=await fs.readFile(original.path);
  await page.locator('[data-edit]').first().click();await expect(page.locator('#edit-fields')).toBeVisible();await page.locator('#edit-text').fill('참가 인원: 119명');
  await electronApp.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});await page.locator('#edit-save').click();await expect(page.locator('#edit-save')).toBeEnabled();await expect(page.locator('#edit-dialog')).toBeVisible();
  await electronApp.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},original.path);await page.locator('#edit-save').click();await expect(page.locator('#edit-error')).toContainText('덮어쓰지');expect(await fs.readFile(original.path)).toEqual(before);
  await fs.writeFile(original.path,Buffer.concat([before,Buffer.from('external-change')]));
  await electronApp.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path.join(temp,'stale.hwpx'));await page.locator('#edit-save').click();await expect(page.locator('#edit-error')).toContainText('변경되었습니다');
  await expect(fs.stat(path.join(temp,'stale.hwpx'))).rejects.toThrow();
  await page.keyboard.press('Escape');await expect(page.locator('#edit-dialog')).not.toBeVisible();await fs.writeFile(original.path,before);
});
