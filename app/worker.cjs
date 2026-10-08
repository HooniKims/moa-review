const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs');
const {parseDocument}=require('../src/documents.cjs');
const {analyze}=require('../src/analyzer.cjs');
try {
  const documents=[],errors=[];
  for(const file of workerData.paths) {
    try {if(fs.statSync(file).size>50*1024*1024)throw new Error('50MB 이하 파일만 지원합니다.');documents.push(parseDocument(fs.readFileSync(file),file));}
    catch(e){errors.push({name:require('node:path').basename(file),message:e.message});}
  }
  const report=analyze(documents,{year:workerData.year});report.errors=errors;
  parentPort.postMessage({ok:true,documents,errors,report});
} catch(e){parentPort.postMessage({ok:false,error:e.message});}
