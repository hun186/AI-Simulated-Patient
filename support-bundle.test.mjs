import test from 'node:test';
import assert from 'node:assert/strict';
import { createZipBytes,createZipBlob } from './support-bundle.js';

test('support bundle writer emits a UTF-8 stored ZIP with all requested files',async()=>{
  const files={
    'README.txt':'評量失敗支援包',
    'metadata.json':'{"errorId":"EVL-TEST"}',
    'raw_ai_response.txt':'raw output'
  };
  const bytes=createZipBytes(files);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  assert.equal(view.getUint32(0,true),0x04034b50);
  assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
  assert.equal(view.getUint16(bytes.length-22+10,true),3);
  const text=new TextDecoder().decode(bytes);
  for(const name of Object.keys(files))assert.match(text,new RegExp(name.replace('.','\\.')));
  const blob=createZipBlob(files);
  assert.equal(blob.type,'application/zip');
  assert.equal(blob.size,bytes.length);
});
