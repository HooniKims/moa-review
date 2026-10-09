'use strict';
// Build and publish an immutable GitHub Release from a clean, pushed commit.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json');
const {owner,repo}=pkg.build.publish,version=pkg.version,tag=`v${version}`;
const dir=path.join(root,'release',version);
const run=(command,args,inherit=false)=>execFileSync(command,args,{cwd:root,encoding:'utf8',stdio:inherit?'inherit':['ignore','pipe','pipe'],windowsHide:true});
const fail=message=>{throw new Error(message);};
function main(){
  if(!/^\d+\.\d+\.\d+$/.test(version))fail('정식 릴리즈에는 숫자 세 자리 버전을 사용하세요.');
  if(run('git',['status','--porcelain']).trim())fail('변경 사항을 먼저 커밋하세요.');
  run('git',['fetch','origin','--tags']);
  const head=run('git',['rev-parse','HEAD']).trim(),branch=run('git',['branch','--show-current']).trim();
  if(head!==run('git',['rev-parse',`origin/${branch}`]).trim())fail('현재 커밋을 origin에 먼저 push하세요.');
  if(run('git',['tag','--list',tag]).trim())fail('이미 배포한 버전입니다. 버전을 올려 주세요.');
  const notes=fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8');
  const section=notes.split(`## ${version}\n`)[1]?.split(/\n## /)[0]?.trim();
  if(!section)fail('CHANGELOG.md에 이번 버전의 변경 내용을 적어 주세요.');
  run(process.execPath,['--test',...fs.readdirSync(path.join(root,'tests')).filter(n=>n.endsWith('.test.cjs')).map(n=>`tests/${n}`)],true);
  run(process.execPath,[require.resolve('@playwright/test/cli'),'test'],true);
  run(process.execPath,[require.resolve('electron-builder/cli'),'--win','nsis','zip','--x64','--publish','never',`--config.directories.output=${dir}`],true);
  const names=[`MoaReview-Setup-${version}.exe`,`MoaReview-Setup-${version}.exe.blockmap`,`MoaReview-${version}-x64.zip`,'latest.yml'];
  const paths=names.map(n=>path.join(dir,n));
  paths.forEach(file=>{if(!fs.existsSync(file))fail(`배포 파일 누락: ${file}`);});
  if(!fs.readFileSync(path.join(dir,'latest.yml'),'utf8').includes(`version: ${version}`))fail('업데이트 메타데이터 버전이 다릅니다.');
  fs.writeFileSync(path.join(dir,'SHA256SUMS.txt'),names.map(n=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,n))).digest('hex')}  ${n}`).join('\n')+'\n');
  const notesPath=path.join(dir,'release-notes.md');
  fs.writeFileSync(notesPath,`${section}\n\n설치형: MoaReview-Setup-${version}.exe\n압축 배포본: MoaReview-${version}-x64.zip (전체 압축 해제 후 실행)\n\n설치형은 앱에서 업데이트를 받고, ZIP 배포본은 새 ZIP을 내려받아 교체합니다.\n`);
  run('gh',['release','create',tag,...paths,path.join(dir,'SHA256SUMS.txt'),'--repo',`${owner}/${repo}`,'--target',head,'--title',`쎈Pick ${version}`,'--notes-file',notesPath,...(process.argv.includes('--draft')?['--draft']:[])],true);
}
try{main();}catch(error){console.error(`릴리즈 중단: ${error.message}`);process.exitCode=1;}
