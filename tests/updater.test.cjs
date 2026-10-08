const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createUpdater,isNewer,RELEASE_REPOSITORY}=require('../app/updater.cjs');
function fixture(options={}){
  const engine=new EventEmitter();let checks=0,downloads=0,installs=0;
  engine.checkForUpdates=async()=>{checks++;engine.emit('update-available',{version:'1.2.0'});};
  engine.downloadUpdate=async()=>{downloads++;engine.emit('update-downloaded',{version:'1.2.0'});};
  engine.quitAndInstall=(silent,run)=>{assert.equal(silent,true);assert.equal(run,true);installs++;};
  const updater=createUpdater({app:{isPackaged:true,getVersion:()=> '1.1.0'},isInstalled:true,loadAutoUpdater:()=>engine,...options});
  return {engine,updater,get checks(){return checks;},get downloads(){return downloads;},get installs(){return installs;}};
}
test('runtime release repository matches packaging provider',()=>assert.deepEqual(RELEASE_REPOSITORY,{owner:require('../package.json').build.publish.owner,repo:require('../package.json').build.publish.repo}));
test('stable versions compare numerically and reject malformed/prerelease versions',()=>{
  assert.ok(isNewer('v1.10.0','1.9.9'));assert.ok(isNewer('2.0.0','1.99.99'));
  for(const v of ['1.0.0','1.1.0','1.2.0-beta','1.2.0junk','01.2.0','bad'])assert.equal(isNewer(v,'1.1.0'),false);
});
test('installed update requires download and explicit restart; check clicks coalesce',async()=>{
  const f=fixture();assert.equal(f.updater.install(),false);
  await Promise.all([f.updater.check(),f.updater.check()]);assert.equal(f.checks,1);
  assert.equal(f.downloads,0);assert.equal(f.engine.autoDownload,false);assert.equal(f.engine.autoInstallOnAppQuit,false);assert.equal(f.engine.allowDowngrade,false);
  assert.equal(f.updater.state.phase,'available');await f.updater.download();assert.equal(f.downloads,1);assert.equal(f.updater.state.phase,'ready');
  await f.updater.check();assert.equal(f.checks,1);assert.equal(f.installs,0);
  assert.ok(f.updater.install());assert.equal(f.updater.install(),false);
  await new Promise(setImmediate);assert.equal(f.installs,1);
});
test('offline and synchronous errors are recoverable',async()=>{
  const f=fixture();f.engine.checkForUpdates=()=>{throw Error('ENOTFOUND');};
  assert.equal((await f.updater.check()).phase,'error');assert.match(f.updater.state.message,/인터넷 연결/);
  f.engine.checkForUpdates=async()=>f.engine.emit('update-not-available');assert.equal((await f.updater.check()).phase,'latest');
});
test('failed downloads can retry and cannot install incomplete files',async()=>{
  const f=fixture();await f.updater.check();f.engine.downloadUpdate=async()=>{throw Error('checksum mismatch');};
  await f.updater.download();assert.equal(f.updater.state.phase,'error');assert.equal(f.updater.install(),false);await f.updater.check();assert.equal(f.updater.state.phase,'available');
});
test('ZIP only checks GitHub; download and install never invoke engine',async()=>{
  const f=fixture({isInstalled:false,loadAutoUpdater:()=>{throw Error('ZIP must not self-install');},fetchRelease:async url=>{assert.equal(url,'https://api.github.com/repos/HooniKims/moa-review/releases/latest');return {ok:true,json:async()=>({tag_name:'v1.2.0',html_url:'https://malicious.example'})};}});
  await f.updater.check();assert.equal(f.updater.state.phase,'available');assert.equal(f.updater.state.mode,'zip');assert.match(f.updater.state.releaseUrl,/^https:\/\/github.com\/HooniKims\/moa-review\//);
  await f.updater.download();assert.equal(f.updater.install(),false);
});
test('missing release is an error, never a false latest-version claim',async()=>{
  const f=fixture({isInstalled:false,fetchRelease:async()=>({ok:false,status:404})});await f.updater.check();assert.equal(f.updater.state.phase,'error');assert.match(f.updater.state.message,/배포된 업데이트 정보/);
});
test('development does not make network calls',async()=>{
  const f=fixture({app:{isPackaged:false,getVersion:()=> '1.1.0'},loadAutoUpdater:()=>{throw Error('No dev network');}});f.updater.start();await f.updater.check();assert.equal(f.updater.state.phase,'disabled');f.updater.stop();
});
