const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');

test('real electron-updater transport validates downloads and rejects a wrong SHA-512',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'moa-update-transport-'));
  const bytes=Buffer.alloc(512*1024,65);bytes.write('MZ'); // Never executed: transport fixture only.
  const sha512=crypto.createHash('sha512').update(bytes).digest('base64');
  const requests=[];
  const server=http.createServer((req,res)=>{
    const route=new URL(req.url,'http://localhost').pathname;requests.push(route);
    if(route.endsWith('latest.yml')){
      const hash=route.startsWith('/bad/')?Buffer.alloc(64).toString('base64'):sha512;
      res.setHeader('Content-Type','text/yaml');res.end(`version: 99.0.0\nfiles:\n  - url: fixture.exe\n    sha512: ${hash}\n    size: ${bytes.length}\npath: fixture.exe\nsha512: ${hash}\nreleaseDate: '2026-10-08T00:00:00.000Z'\n`);
    }else if(route.endsWith('fixture.exe')){res.setHeader('Content-Length',bytes.length);res.end(bytes);}
    else {res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const env={...process.env,MOA_TEST_DATA:path.join(temp,'profile'),MOA_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  let electron;
  try{
    electron=await _electron.launch({args:[path.resolve(__dirname,'..')],env});await electron.firstWindow();
    const result=await electron.evaluate(async({app},data)=>{
      const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
      const fs=require('node:fs/promises'),path=require('node:path');
      const {NsisUpdater}=require('electron-updater');
      const {createUpdater}=require(path.join(app.getAppPath(),'app/updater.cjs'));
      const outcomes=[];
      for(const kind of ['good','bad']){
        const config=path.join(data.temp,`${kind}.yml`);await fs.writeFile(config,`updaterCacheDirName: ${kind}\n`);
        const engine=new NsisUpdater();
        // Isolate cache and version while retaining the real Electron HTTP executor.
        engine.app={isPackaged:true,version:app.getVersion(),name:'MoaTransportTest',whenReady:()=>app.whenReady(),userDataPath:app.getPath('userData'),baseCachePath:data.temp,appUpdateConfigPath:config,onQuit:()=>{},quit:()=>{throw Error('Transport test must not quit/install');}};
        engine.updateConfigPath=config;engine.disableDifferentialDownload=true;
        engine.setFeedURL({provider:'generic',url:`${data.base}/${kind}/`});
        const states=[];
        const updater=createUpdater({app:{isPackaged:true,getVersion:()=>app.getVersion()},isInstalled:true,loadAutoUpdater:()=>engine,onChange:s=>states.push(s.phase)});
        await updater.check();await updater.download();
        outcomes.push({kind,state:updater.state,states,installer:engine.installerPath});
      }
      return outcomes;
    },{temp,base});
    expect(result[0].state.phase).toBe('ready');expect(result[0].states).toContain('downloading');
    expect(crypto.createHash('sha512').update(await fs.readFile(result[0].installer)).digest('base64')).toBe(sha512);
    expect(result[1].state.phase).toBe('error');expect(result[1].states).not.toContain('ready');
    expect(requests).toContain('/good/fixture.exe');expect(requests).toContain('/bad/fixture.exe');
  }finally{if(electron)await electron.close();await new Promise(resolve=>server.close(resolve));}
});
