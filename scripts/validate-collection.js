import {readFile} from 'node:fs/promises';
import {decorateCards,validateCollection,ATTRIBUTES} from '../public/engine.js';

const path=process.argv[2]||'public/data/chimpions.json';
const strict=process.argv.includes('--strict')||process.env.STRICT_COLLECTION==='1';
const manifest=JSON.parse(await readFile(path,'utf8'));
const report=validateCollection(manifest),cards=decorateCards(manifest.cards||[]);
for(const c of cards){
  const vals=ATTRIBUTES.map(a=>c.stats[a]),sum=vals.reduce((a,b)=>a+b,0);
  if(sum!==360)report.errors.push(`${c.name}: stat budget ${sum}, expected 360`);
  if(vals.some(v=>v<34||v>86))report.errors.push(`${c.name}: stat outside 34–86`);
}
report.valid=report.errors.length===0;
console.log(JSON.stringify(report,null,2));
if(!report.valid||(strict&&report.expected&&report.count!==report.expected))process.exitCode=1;
