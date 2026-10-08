const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs');
const {prepareEdit,applyEdit,hash}=require('../src/document-edit.cjs');
try{
  const {action,filePath,source,expectedHash,text}=workerData;
  if(fs.statSync(filePath).size>50*1024*1024)throw new Error('50MB 이하 파일만 수정할 수 있습니다.');
  const bytes=fs.readFileSync(filePath);
  if(hash(bytes)!==expectedHash)throw new Error('검사 후 원본 파일이 변경되었습니다. 다시 검사한 뒤 수정해 주세요.');
  if(action==='prepare'){
    const edit=prepareEdit(bytes,filePath,source);
    parentPort.postMessage({ok:true,text:edit.text,type:edit.type,hint:edit.hint});
  }else if(action==='apply')parentPort.postMessage({ok:true,...applyEdit(bytes,filePath,source,text,expectedHash)});
  else throw new Error('지원하지 않는 편집 요청입니다.');
}catch(e){parentPort.postMessage({ok:false,error:e.message});}
