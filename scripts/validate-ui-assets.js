import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd();
const tutorials=['tactical','ban-counter','triple','team-tag'];

function webpDimensions(buffer){
  assert.equal(buffer.subarray(0,4).toString('ascii'),'RIFF','missing RIFF signature');
  assert.equal(buffer.subarray(8,12).toString('ascii'),'WEBP','missing WEBP signature');
  let offset=12;
  while(offset+8<=buffer.length){
    const fourcc=buffer.subarray(offset,offset+4).toString('ascii');
    const size=buffer.readUInt32LE(offset+4);
    const data=offset+8;
    if(fourcc==='VP8X'&&data+10<=buffer.length){
      return {width:1+buffer.readUIntLE(data+4,3),height:1+buffer.readUIntLE(data+7,3),codec:fourcc.trim()};
    }
    if(fourcc==='VP8 '&&data+10<=buffer.length){
      assert.deepEqual([...buffer.subarray(data+3,data+6)],[0x9d,0x01,0x2a],'invalid VP8 frame header');
      return {width:buffer.readUInt16LE(data+6)&0x3fff,height:buffer.readUInt16LE(data+8)&0x3fff,codec:fourcc.trim()};
    }
    if(fourcc==='VP8L'&&data+5<=buffer.length){
      assert.equal(buffer[data],0x2f,'invalid VP8L signature');
      const bits=buffer.readUInt32LE(data+1);
      return {width:(bits&0x3fff)+1,height:((bits>>14)&0x3fff)+1,codec:fourcc.trim()};
    }
    offset=data+size+(size%2);
  }
  throw new Error('No decodable WebP image chunk found');
}

for(const name of tutorials){
  const file=path.join(root,'public','tutorials',`${name}.webp`);
  const buffer=fs.readFileSync(file);
  assert.ok(buffer.byteLength>=300_000,`${name}.webp is unexpectedly small (${buffer.byteLength} bytes); likely degraded or corrupt`);
  const dim=webpDimensions(buffer);
  assert.ok(dim.width>=1200&&dim.height>=1200,`${name}.webp is too low resolution: ${dim.width}x${dim.height}`);
  assert.ok(Math.abs(dim.width/dim.height-1)<0.01,`${name}.webp should remain square`);
  console.log(`✓ ${name}: ${dim.width}x${dim.height}, ${(buffer.byteLength/1024).toFixed(0)} KiB, ${dim.codec}`);
}

const back=fs.readFileSync(path.join(root,'public','ui','opponent-card-back.svg'),'utf8');
assert.match(back,/viewBox="0 0 1000 1470"/,'opponent card back must use the premium 1000x1470 vector canvas');
assert.match(back,/OPPONENT CARD/,'opponent card back label missing');
assert.match(back,/REVEALED AFTER LOCK-IN/,'opponent card back lock-in copy missing');

const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
assert.match(html,/aaa-polish\.css/,'AAA polish stylesheet is not loaded');
assert.match(html,/aaa-enhancements\.js/,'AAA enhancement script is not loaded');

console.log('UI asset validation passed: high-resolution tutorials, premium opponent back, and enhancement layer are wired.');
