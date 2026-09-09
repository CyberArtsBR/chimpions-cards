import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.CHIMPIONS_API||'https://www.chimpions.co/api/nfts',expected=Number(process.env.CHIMPIONS_EXPECTED_TOTAL||222),allowPartial=process.env.ALLOW_PARTIAL_IMPORT==='1';
const all=[];let page=1,apiReportedTotal=null,guard=0;
while(guard++<100){
  const url=new URL(base);url.searchParams.set('page',String(page));
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'chimpions-attribute-arena/1.0'},cache:'no-store'});if(!r.ok)throw new Error(`Gallery page ${page}: ${r.status}`);
  const body=await r.json();apiReportedTotal=Number(body.total??body.count??apiReportedTotal??expected);
  const items=body.nfts??body.cards??body.items??body.data??[];
  if(!Array.isArray(items))throw new Error(`Gallery page ${page}: unsupported response shape`);
  for(const n of items){
    const id=Number(n.tokenId??n.id??n.number),mint=n.mint??n.address??n.mintAddress,name=String(n.name||'').trim(),image=n.animationUrl??n.animation_url??n.animation??n.image;
    all.push({id,mint,name,image,poster:n.image??n.poster,tribe:n.tribe??n.faction??'Unaligned',artist:n.artist??''});
  }
  const hasMore=body.hasMore??body.has_more??(items.length>0&&all.length<(apiReportedTotal||expected));if(!hasMore)break;page=Number(body.nextPage??body.next_page??page+1)
}
const byKey=new Map();for(const x of all.filter(x=>Number.isFinite(x.id)&&x.name&&/^https:\/\//.test(x.image||''))){const key=x.mint||`${x.id}:${x.name}`;if(!byKey.has(key))byKey.set(key,x)}
const cards=[...byKey.values()].sort((a,b)=>a.id-b.id);
if(!allowPartial&&cards.length!==expected)throw new Error(`Collection import incomplete: ${cards.length}/${expected} (API reports ${apiReportedTotal??'unknown'}). Set ALLOW_PARTIAL_IMPORT=1 only when intentionally preserving an incomplete official snapshot.`);
await mkdir('public/data',{recursive:true});await writeFile('public/data/chimpions.json',JSON.stringify({source:base,importedAt:new Date().toISOString(),reportedTotal:expected,expectedTotal:expected,apiReportedTotal,cards},null,2));
console.log(JSON.stringify({expectedTotal:expected,apiReportedTotal,discovered:all.length,valid:cards.length,duplicates:all.length-cards.length,complete:cards.length===expected},null,2));
