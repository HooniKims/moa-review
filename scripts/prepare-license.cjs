'use strict';
// NSIS shows Korean text correctly only from UTF-16LE with BOM and CRLF line endings.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),text=fs.readFileSync(path.join(root,'LICENSE'),'utf8');
if(!text.includes('이용약관')||/\{[^}]*\}/.test(text))throw new Error('LICENSE 약관 문안을 확인하세요.');
fs.writeFileSync(path.join(root,'build/LICENSE.txt'),Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(text.replace(/\r?\n/g,'\r\n'),'utf16le')]));
