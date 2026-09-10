/* Chimpions Arena tutorial source hardening.
   The legacy app still names the old WebPs. This layer immediately remaps every
   tutorial image to the verified vector master so a corrupt raster can never
   produce a black tutorial panel. */
(() => {
  'use strict';
  const names=['tactical','ban-counter','triple','team-tag'];
  const map=new Map(names.map(name=>[`/tutorials/${name}.webp`,`/tutorials/${name}.svg`]));
  const vectorFor=src=>{
    try{return map.get(new URL(src,location.href).pathname)||null}catch{return null}
  };
  const repair=img=>{
    if(!(img instanceof HTMLImageElement))return;
    if(img.id!=='modeTutorialImg'&&img.id!=='aaaTutorialFullImage')return;
    const next=vectorFor(img.getAttribute('src')||img.src);
    if(next&&img.getAttribute('src')!==next){
      img.src=next;
      img.decoding='async';
      img.loading='eager';
      img.removeAttribute('hidden');
    }
  };
  const scan=root=>{
    if(root instanceof HTMLImageElement)repair(root);
    root?.querySelectorAll?.('#modeTutorialImg,#aaaTutorialFullImage').forEach(repair);
  };
  const observer=new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='attributes')repair(record.target);
      else record.addedNodes.forEach(scan);
    }
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
  scan(document);
  for(const name of names){const img=new Image();img.decoding='async';img.src=`/tutorials/${name}.svg`}
})();
