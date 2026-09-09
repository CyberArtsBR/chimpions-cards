import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.CHIMPIONS_API || 'https://www.chimpions.co/api/nfts';
const all=[]; let page=1,total=null;
while(true){
  const r=await fetch(`${base}?page=${page}`); if(!r.ok) throw new Error(`Gallery page ${page}: ${r.status}`);
  const body=await r.json(); total=body.total??total;
  for(const n of body.nfts??[]) all.push({id:Number(n.tokenId),mint:n.mint,name:String(n.name||'').trim(),image:n.animationUrl||n.image,poster:n.image,tribe:n.tribe||'Unaligned',artist:n.artist||''});
  if(!body.hasMore) break; page=body.nextPage??page+1;
}
const byMint=new Map(all.filter(x=>x.mint&&x.name&&/^https:\/\//.test(x.image)).map(x=>[x.mint,x]));
const cards=[...byMint.values()].sort((a,b)=>a.id-b.id);
await mkdir('public/data',{recursive:true}); await writeFile('public/data/chimpions.json',JSON.stringify({source:base,importedAt:new Date().toISOString(),reportedTotal:total,cards},null,2));
console.log(JSON.stringify({reportedTotal:total,discovered:all.length,valid:cards.length,duplicates:all.length-cards.length},null,2));
