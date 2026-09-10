import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const sourceDir=path.join(root,'assets','tutorials');
const outDir=path.join(root,'public','tutorials');
const tutorials=['tactical','ban-counter','triple','team-tag'];

fs.mkdirSync(outDir,{recursive:true});

for(const name of tutorials){
  const prefix=`${name}.b64.part`;
  const parts=fs.readdirSync(sourceDir)
    .filter(file=>file.startsWith(prefix))
    .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  if(!parts.length)throw new Error(`Missing source chunks for ${name}`);
  const encoded=parts.map(file=>fs.readFileSync(path.join(sourceDir,file),'utf8').trim()).join('');
  const buffer=Buffer.from(encoded,'base64');
  if(buffer.subarray(0,4).toString('ascii')!=='RIFF'||buffer.subarray(8,12).toString('ascii')!=='WEBP'){
    throw new Error(`Invalid reconstructed WebP for ${name}`);
  }
  const target=path.join(outDir,`${name}.webp`);
  fs.writeFileSync(target,buffer);
  console.log(`built ${path.relative(root,target)} (${buffer.byteLength} bytes)`);
}
