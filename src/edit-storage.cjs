const fs=require('node:fs/promises'),path=require('node:path');
async function saveCopy(destination,sourcePath,originals,buffer){
  const target=path.resolve(destination),ext=path.extname(sourcePath).toLowerCase();
  if(path.extname(target).toLowerCase()!==ext)throw new Error(`${ext} 확장자로 수정본을 저장해 주세요.`);
  if(originals.some(p=>path.resolve(p).toLowerCase()===target.toLowerCase()))throw new Error('검토 중인 원본은 덮어쓰지 않습니다. 다른 이름으로 저장해 주세요.');
  let handle;
  try{handle=await fs.open(target,'wx');}
  catch(e){if(e.code==='EEXIST')throw new Error('같은 이름의 파일이 있습니다. 다른 이름으로 저장해 주세요.');throw e;}
  try{await handle.writeFile(buffer);await handle.sync();await handle.close();}
  catch(e){await handle.close().catch(()=>{});await fs.unlink(target).catch(()=>{});throw e;}
  return target;
}
module.exports={saveCopy};
