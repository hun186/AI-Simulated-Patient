const encoder=new TextEncoder();

function write16(view,offset,value){
  view.setUint16(offset,value,true);
}
function write32(view,offset,value){
  view.setUint32(offset,value>>>0,true);
}

function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){
    crc^=byte;
    for(let bit=0;bit<8;bit+=1){
      crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
  }
  return (crc^0xffffffff)>>>0;
}

function concat(chunks,totalLength){
  const output=new Uint8Array(totalLength);
  let offset=0;
  for(const chunk of chunks){
    output.set(chunk,offset);
    offset+=chunk.length;
  }
  return output;
}

function localHeader(nameBytes,dataBytes,crc){
  const bytes=new Uint8Array(30+nameBytes.length);
  const view=new DataView(bytes.buffer);
  write32(view,0,0x04034b50);
  write16(view,4,20);
  write16(view,6,0x0800);
  write16(view,8,0);
  write16(view,10,0);
  write16(view,12,0);
  write32(view,14,crc);
  write32(view,18,dataBytes.length);
  write32(view,22,dataBytes.length);
  write16(view,26,nameBytes.length);
  write16(view,28,0);
  bytes.set(nameBytes,30);
  return bytes;
}

function centralHeader(nameBytes,dataBytes,crc,localOffset){
  const bytes=new Uint8Array(46+nameBytes.length);
  const view=new DataView(bytes.buffer);
  write32(view,0,0x02014b50);
  write16(view,4,20);
  write16(view,6,20);
  write16(view,8,0x0800);
  write16(view,10,0);
  write16(view,12,0);
  write16(view,14,0);
  write32(view,16,crc);
  write32(view,20,dataBytes.length);
  write32(view,24,dataBytes.length);
  write16(view,28,nameBytes.length);
  write16(view,30,0);
  write16(view,32,0);
  write16(view,34,0);
  write16(view,36,0);
  write32(view,38,0);
  write32(view,42,localOffset);
  bytes.set(nameBytes,46);
  return bytes;
}

export function createZipBytes(files){
  const entries=Object.entries(files||{}).map(([name,value])=>({
    nameBytes:encoder.encode(String(name)),
    dataBytes:encoder.encode(String(value??''))
  }));
  const localChunks=[];
  const centralChunks=[];
  let localOffset=0;
  for(const entry of entries){
    const crc=crc32(entry.dataBytes);
    const header=localHeader(entry.nameBytes,entry.dataBytes,crc);
    localChunks.push(header,entry.dataBytes);
    centralChunks.push(centralHeader(entry.nameBytes,entry.dataBytes,crc,localOffset));
    localOffset+=header.length+entry.dataBytes.length;
  }
  const centralOffset=localOffset;
  const centralLength=centralChunks.reduce((sum,chunk)=>sum+chunk.length,0);
  const end=new Uint8Array(22);
  const endView=new DataView(end.buffer);
  write32(endView,0,0x06054b50);
  write16(endView,4,0);
  write16(endView,6,0);
  write16(endView,8,entries.length);
  write16(endView,10,entries.length);
  write32(endView,12,centralLength);
  write32(endView,16,centralOffset);
  write16(endView,20,0);
  return concat([...localChunks,...centralChunks,end],centralOffset+centralLength+end.length);
}

export function createZipBlob(files){
  return new Blob([createZipBytes(files)],{type:'application/zip'});
}
