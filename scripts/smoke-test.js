import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {WebSocket} from 'ws';

const port=Number(process.env.SMOKE_PORT||32123);
const base=`http://127.0.0.1:${port}`;
const wsBase=`ws://127.0.0.1:${port}/room`;
const child=spawn(process.execPath,['server/index.js'],{
  env:{...process.env,PORT:String(port)},
  stdio:['ignore','pipe','pipe']
});
let stdout='',stderr='';
child.stdout.on('data',d=>stdout+=d);
child.stderr.on('data',d=>stderr+=d);

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function waitUntil(fn,{timeout=5000,label='condition'}={}){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(fn())return;sleep(25);await sleep(25)}
  throw new Error(`Timed out waiting for ${label}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}
function client(){
  const ws=new WebSocket(wsBase),messages=[];
  ws.on('message',raw=>{try{messages.push(JSON.parse(raw))}catch{}});
  return {ws,messages};
}
async function waitOpen(ws){
  if(ws.readyState===WebSocket.OPEN)return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('WebSocket open timeout')),3000);
    ws.once('open',()=>{clearTimeout(timer);resolve()});
    ws.once('error',e=>{clearTimeout(timer);reject(e)});
  });
}
async function take(c,type,timeout=4000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    const i=c.messages.findIndex(m=>m.type===type);
    if(i>=0)return c.messages.splice(i,1)[0];
    await sleep(20);
  }
  throw new Error(`Timed out waiting for WS message "${type}". Seen: ${JSON.stringify(c.messages)}`);
}

let a,b;
try{
  await waitUntil(()=>stdout.includes('CHIMPIONS Arena on'),{label:'server startup'});

  const health=await fetch(`${base}/healthz`);
  assert.equal(health.status,200);
  assert.deepEqual(await health.json(),{ok:true,service:'chimpions-arena'});

  const home=await fetch(base);
  assert.equal(home.status,200);
  assert.match(await home.text(),/CHIMPIONS/i);

  const headerLogo=await fetch(`${base}/ui/logo-header.svg`);
  assert.equal(headerLogo.status,200);
  assert.match(headerLogo.headers.get('content-type')||'',/image\/svg\+xml/i);
  assert.match(await headerLogo.text(),/viewBox="0 0 76 45"/);

  const battleTheme=await fetch(`${base}/audio/battle-theme.mp3`);
  assert.equal(battleTheme.status,200);
  assert.match(battleTheme.headers.get('content-type')||'',/audio\/mpeg/i);
  assert.ok((await battleTheme.arrayBuffer()).byteLength>3_000_000);

  for(const name of ['tactical','ban-counter','triple','team-tag']){
    const tutorial=await fetch(`${base}/tutorials/${name}.webp`);
    assert.equal(tutorial.status,200);
    assert.equal(tutorial.headers.get('content-type'),'image/webp');
    const tutorialBytes=Buffer.from(await tutorial.arrayBuffer());
    assert.ok(tutorialBytes.byteLength>5_000);
    assert.equal(tutorialBytes.subarray(0,4).toString('ascii'),'RIFF');
    assert.equal(tutorialBytes.subarray(8,12).toString('ascii'),'WEBP');
  }

  const opponentBack=await fetch(`${base}/ui/opponent-card-back.svg`);
  assert.equal(opponentBack.status,200);
  assert.match(opponentBack.headers.get('content-type')||'',/image\/svg\+xml/i);
  const opponentBackSvg=await opponentBack.text();
  assert.match(opponentBackSvg,/viewBox="0 0 1024 1536"/);
  assert.match(opponentBackSvg,/OPPONENT CARD/);
  assert.match(opponentBackSvg,/Revealed After Lock-In/);

  const video=await fetch(`${base}/video/crowd-and-flag.mp4`,{method:'HEAD'});
  assert.equal(video.status,200);
  assert.equal(video.headers.get('content-type'),'video/mp4');
  const videoSize=Number(video.headers.get('content-length'));
  assert.ok(videoSize>1_000_000);
  for(const [range,length] of [['bytes=0-1023',1024],['bytes=-128',128]]){
    const partial=await fetch(`${base}/video/crowd-and-flag.mp4`,{headers:{Range:range}});
    assert.equal(partial.status,206);
    assert.equal((await partial.arrayBuffer()).byteLength,length);
    assert.match(partial.headers.get('content-range'),/^bytes /);
  }
  const invalid=await fetch(`${base}/video/crowd-and-flag.mp4`,{headers:{Range:`bytes=${videoSize}-`}});
  assert.equal(invalid.status,416);

  const manifestResponse=await fetch(`${base}/data/chimpions.json`);
  assert.equal(manifestResponse.status,200);
  const manifest=await manifestResponse.json();
  assert.equal(manifest.cards.length,221);
  assert.equal(manifest.apiReportedTotal,221);
  assert.equal(manifest.expectedTotal,222);

  a=client();b=client();
  await Promise.all([waitOpen(a.ws),waitOpen(b.ws)]);

  // Team Tag must survive the complete room handshake.
  a.ws.send(JSON.stringify({type:'create',mode:'team-tag'}));
  const room=await take(a,'room');
  assert.match(room.code,/^[A-Z]{4}$/);
  assert.equal(room.mode,'team-tag');

  b.ws.send(JSON.stringify({type:'join',code:room.code}));
  const [readyA,readyB]=await Promise.all([take(a,'ready'),take(b,'ready')]);
  assert.equal(readyA.code,room.code);
  assert.equal(readyB.code,room.code);

  const [stateA,stateB]=await Promise.all([take(a,'state'),take(b,'state')]);
  for(const state of [stateA,stateB]){
    assert.equal(state.mode,'team-tag');
    assert.equal(typeof state.turn,'boolean');
    assert.ok(state.card?.name);
    assert.deepEqual(state.counts,[20,20]);
    assert.ok(Array.isArray(state.legal)&&state.legal.length>0);
    assert.ok(Array.isArray(state.cards)&&state.cards.length===2);
    assert.equal(state.phase,'choose');
    assert.ok(state.deadline>Date.now());
  }
  assert.notEqual(stateA.turn,stateB.turn);

  console.log('Production smoke test passed: HTTP, tutorial banners, header logo, audio/video, 221-card manifest, and Team Tag 1v1 room handshake.');
}finally{
  for(const c of [a,b])try{c?.ws?.close()}catch{}
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(r=>child.once('exit',r)),
    sleep(1000).then(()=>{try{child.kill('SIGKILL')}catch{}})
  ]);
}
