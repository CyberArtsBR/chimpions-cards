import {
  ATTRIBUTES,MODES,createMatch,legalAttributes,resolveRound,advanceMatch,finishMatch,
  reserveSwap,chooseCpuAttribute,attributeWinRate,decorateCards,validateCollection
} from './engine.js';

const $=s=>document.querySelector(s),app=$('#app');
let cards=[],manifest=null,game=null,screen='menu',epoch=0,socket=null,netState=null;
const timers=new Set(),intervals=new Set();
const REVEAL_HOLD_MS=3000,CPU_THINK_MS=900;
const prefs={sfx:localStorage.getItem('chimpions:sfx')!=='off',music:localStorage.getItem('chimpions:music')!=='off'};
let audioCtx=null,musicInterval=null,musicStep=0,musicMaster=null,noiseBuffer=null;

const placeholder=`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#111527"/><circle cx="300" cy="260" r="120" fill="#242b45"/><text x="300" y="300" text-anchor="middle" font-family="sans-serif" font-size="128" font-weight="800" fill="#c8ff42">C</text><text x="300" y="450" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#aeb5cc">CHIMPION</text></svg>`)}`;

function schedule(fn,ms){const e=epoch,id=setTimeout(()=>{timers.delete(id);if(e===epoch)fn()},ms);timers.add(id);return id}
function every(fn,ms){const e=epoch,id=setInterval(()=>{if(e===epoch)fn();else{clearInterval(id);intervals.delete(id)}},ms);intervals.add(id);return id}
function cleanup({closeSocket=true}={}){
  epoch++; for(const id of timers)clearTimeout(id);timers.clear();for(const id of intervals)clearInterval(id);intervals.clear();
  if(closeSocket&&socket){try{socket.close()}catch{}socket=null;netState=null}
}
function go(name){cleanup();screen=name;({menu,gallery,help,online}[name]||menu)()}

function ensureAudio(){
  if(!audioCtx){
    audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    musicMaster=audioCtx.createGain();musicMaster.gain.value=.78;musicMaster.connect(audioCtx.destination);
    noiseBuffer=audioCtx.createBuffer(1,Math.floor(audioCtx.sampleRate*.09),audioCtx.sampleRate);
    const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
  }
  if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
  if(prefs.music&&!musicInterval){musicStep=0;musicBeat();musicInterval=setInterval(musicBeat,420)}
}
function tone(freq,duration=.12,gain=.035,type='sine',delay=0,bus='sfx'){
  if(!audioCtx)return;const t=audioCtx.currentTime+delay,o=audioCtx.createOscillator(),g=audioCtx.createGain(),dest=bus==='music'&&musicMaster?musicMaster:audioCtx.destination;
  o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.018);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g).connect(dest);o.start(t);o.stop(t+duration+.04)
}
function noiseHit(duration=.05,gain=.012){
  if(!audioCtx||!noiseBuffer||!musicMaster)return;const src=audioCtx.createBufferSource(),filter=audioCtx.createBiquadFilter(),g=audioCtx.createGain(),t=audioCtx.currentTime;
  src.buffer=noiseBuffer;filter.type='highpass';filter.frequency.value=2600;g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+duration);src.connect(filter).connect(g).connect(musicMaster);src.start(t);src.stop(t+duration)
}
function sfx(type){
  if(!prefs.sfx)return;ensureAudio();
  const map={ui:[520],select:[360,620,920],reveal:[150,300,600],win:[440,660,880,1320],lose:[240,180,120],tie:[330,440,330],swap:[520,390],final:[523,659,784,1047,1318]};
  (map[type]||map.ui).forEach((freq,i)=>tone(freq,type==='reveal'?.2:.15,type==='final'?.05:.042,i%2?'triangle':'sine',i*.065))
}
function musicBeat(){
  if(!prefs.music||!audioCtx||audioCtx.state!=='running')return;
  const step=musicStep++%16,bass=[55,55,65.41,49],arp=[220,261.63,329.63,392,329.63,261.63,246.94,293.66,220,261.63,349.23,440,349.23,293.66,246.94,196];
  tone(arp[step],.2,.013,step%2?'triangle':'sine',0,'music');
  if(step%4===0)tone(bass[(step/4)%bass.length],.72,.03,'sine',0,'music');
  if(step%8===0){
    const root=step===0?[110,164.81,220]:[98,146.83,196];
    root.forEach((freq,i)=>tone(freq,1.7,.0065,'sine',i*.02,'music'));
  }
  if([2,6,10,14].includes(step))noiseHit(.045,.009);
}
function toggleAudio(kind){
  prefs[kind]=!prefs[kind];localStorage.setItem(`chimpions:${kind}`,prefs[kind]?'on':'off');
  if(prefs[kind])ensureAudio();
  if(kind==='music'&&!prefs.music&&musicInterval){clearInterval(musicInterval);musicInterval=null}
  renderAudioButtons()
}
function renderAudioButtons(){const s=$('#sfxToggle'),m=$('#musicToggle');if(s){s.textContent=prefs.sfx?'SFX ON':'SFX OFF';s.setAttribute('aria-pressed',String(prefs.sfx))}if(m){m.textContent=prefs.music?'MUSIC ON':'MUSIC OFF';m.setAttribute('aria-pressed',String(prefs.music))}}

function nav(){return `<header><button class="brand" data-go="menu"><b>CHIMPIONS</b><span>ATTRIBUTE ARENA</span></button><nav><button data-go="gallery">Collection</button><button data-go="help">How to play</button><button class="audio-toggle" id="musicToggle" aria-label="Toggle music"></button><button class="audio-toggle" id="sfxToggle" aria-label="Toggle sound effects"></button></nav></header>`}
function bindNav(){
  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  const s=$('#sfxToggle'),m=$('#musicToggle');if(s)s.onclick=()=>toggleAudio('sfx');if(m)m.onclick=()=>toggleAudio('music');renderAudioButtons();bindImages();bindCardTilt();
}
function bindImages(){document.querySelectorAll('img').forEach(img=>{img.addEventListener('error',()=>{if(img.src!==placeholder)img.src=placeholder},{once:true})})}
function bindCardTilt(){
  if(!window.matchMedia?.('(pointer:fine)').matches)return;
  document.querySelectorAll('[data-card-tilt]').forEach(el=>{
    el.onpointermove=e=>{
      const r=el.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
      el.style.setProperty('--rx',`${(0.5-y)*8}deg`);el.style.setProperty('--ry',`${(x-0.5)*10}deg`);
      el.style.setProperty('--mx',`${x*100}%`);el.style.setProperty('--my',`${y*100}%`);
    };
    el.onpointerleave=()=>{el.style.setProperty('--rx','0deg');el.style.setProperty('--ry','0deg');el.style.setProperty('--mx','50%');el.style.setProperty('--my','50%')}
  })
}
function preload(url){if(!url)return;const i=new Image();i.src=url}
function currentMode(){return document.querySelector('[name="mode"]:checked')?.value||MODES.tactical}
const ATTRIBUTE_UI={
  Power:{icon:'◆',short:'PWR'},Agility:{icon:'➤',short:'AGI'},Intellect:{icon:'◈',short:'INT'},
  Tech:{icon:'⌬',short:'TEC'},Mystique:{icon:'✦',short:'MYS'},Charisma:{icon:'★',short:'CHA'}
};
function attrSlug(a=''){return String(a).toLowerCase()}
function topAttribute(c){
  return ATTRIBUTES.reduce((best,a)=>c.stats[a]>c.stats[best]?a:best,ATTRIBUTES[0]);
}
function heroCards(){
  const picks=[cards[29],cards[99],cards[196]].filter(Boolean);
  return picks.map((c,i)=>{
    const top=topAttribute(c);
    return `<article class="hero-chimp-card hc${i+1}">
      <div class="hero-chimp-art"><img src="${c.image}" alt="" loading="eager"></div>
      <div class="hero-chimp-meta"><span>#${String(c.id).padStart(3,'0')}</span><b>${escapeHtml(c.name)}</b><em>${top} ${c.stats[top]}</em></div>
    </article>`
  }).join('');
}

function menu(){
  screen='menu';
  const v=manifest?validateCollection(manifest):null;
  const collectionNote=v?`<div class="collection-status"><span class="live-dot"></span><b>${v.count} playable Chimpions</b><small>Official API collection snapshot</small></div>`:'';
  app.innerHTML=nav()+`<main class="hero"><div class="hero-copy"><div class="eyebrow">${cards.length} ANIMATED CHIMPIONS • COMPETITIVE CARD BATTLE</div><h1>Every Chimpion<br><em>has a way to win.</em></h1><p>Read the matchup, pick the edge, and claim the standoff pot.</p><fieldset class="mode-picker"><legend>Ruleset</legend><label><input type="radio" name="mode" value="classic"><span><b>Classic</b><small>Traditional • winner chooses next</small></span></label><label><input type="radio" name="mode" value="tactical" checked><span><b>Tactical ★</b><small>Recommended • alternating turns • no repeat • 1 reserve swap</small></span></label></fieldset><div class="actions"><button class="primary" id="quick">Play vs CPU</button><button id="onlineBtn">Private 1v1</button></div><div class="features"><span>⚡ 5–8 min matches</span><span>◆ Equal stat budget</span><span>◎ Animated originals</span></div>${collectionNote}</div><div class="hero-card-stack" aria-hidden="true">${heroCards()}<div class="hero-glow"></div></div></main>`;
  $('#quick').onclick=()=>{ensureAudio();sfx('ui');start(currentMode())};$('#onlineBtn').onclick=()=>{ensureAudio();sfx('ui');cleanup();online(currentMode())};bindNav()
}

function start(mode=MODES.tactical){
  cleanup();screen='battle';ensureAudio();
  const starter=Math.random()<.5?0:1;
  game=createMatch(cards,{deckSize:6,maxRounds:24,mode,starter});
  renderBattle();sfx('ui');if(game.active===1)scheduleCpu();
}
function statMarkup(c,a,interactive,selected,disabled){
  const tag=interactive?'button':'div',attrs=interactive?`data-stat="${a}" ${disabled?'disabled':''}`:'',meta=ATTRIBUTE_UI[a]||{icon:'•',short:a};
  return `<${tag} class="stat attr-${attrSlug(a)} ${selected===a?'selected':''} ${disabled?'locked':''}" ${attrs}>
    <span class="stat-icon">${meta.icon}</span><span class="stat-name">${a}</span><b>${c.stats[a]}</b><i style="--v:${c.stats[a]}%"></i>
  </${tag}>`
}
function card(c,{hidden=false,interactive=false,selected=null,slot='player',disabledAttrs=[],outcome=null,reveal=false}={}){
  if(hidden)return `<article class="card back ${slot}"><div class="back-rings"></div><div class="sigil">C</div><b>CHIMPION // CLASSIFIED</b><small>Opponent card reveals after lock-in</small></article>`;
  if(!c)return '';
  const affinity=topAttribute(c),peak=c.stats[affinity],outcomeClass=outcome?` round-${outcome}`:'';
  return `<article class="card premium-card ${slot} affinity-${attrSlug(affinity)}${outcomeClass} ${reveal?'just-revealed':''}" data-card-tilt>
    <div class="card-foil"></div><div class="card-glint"></div><div class="card-inner">
      <div class="art"><img src="${c.image}" alt="${escapeHtml(c.name)}" loading="eager"><span class="tribe-badge">${escapeHtml(c.tribe||'Unaligned')}</span><em class="edge-badge">${ATTRIBUTE_UI[affinity].icon} ${affinity} ${peak}</em></div>
      <div class="cardhead"><small>#${String(c.id).padStart(3,'0')}</small><h2>${escapeHtml(c.name)}</h2><i>${ATTRIBUTE_UI[affinity].short}</i></div>
      <div class="stats">${ATTRIBUTES.map(a=>statMarkup(c,a,interactive,selected,disabledAttrs.includes(a))).join('')}</div>
    </div>
  </article>`
}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function outcomeText(result){
  if(!result)return game.active===0?'Your move — choose an attribute':'CPU is reading the matchup…';
  if(result.winner===null)return `STANDOFF — ${result.values[0]} vs ${result.values[1]}`;
  return `${result.winner===0?'YOU WIN':'CPU WINS'} — ${result.values[0]} vs ${result.values[1]}`;
}
function historyHtml(){
  if(!game.history.length)return '<span class="empty-history">No battles yet</span>';
  return game.history.slice(-4).reverse().map(h=>`<div><b>R${h.round}</b><span>${h.attribute}</span><em>${h.values[0]}–${h.values[1]}</em><i>${h.winner===null?'Tie':h.winner===0?'You':'CPU'}</i></div>`).join('')
}
function battleHud(left,right,rightLabel,round,maxRounds,mode,pot=0){
  return `<div class="hud">
    <div class="hud-side you"><span>YOU</span><div class="hud-count"><b>${left}</b><small>CARDS</small></div></div>
    <div class="hud-round"><small>ROUND</small><b>${round}<i>/</i>${maxRounds}</b><em>${pot?`STANDOFF POT × ${pot}`:String(mode||'').toUpperCase()}</em></div>
    <div class="hud-side rival"><div class="hud-count"><b>${right}</b><small>CARDS</small></div><span>${rightLabel}</span></div>
  </div>`
}
function idleVersus(canChoose,pot=0){
  return `<div class="versus idle-versus"><div class="arena-core"><span>VS</span></div><b>${canChoose?'CHOOSE YOUR EDGE':'OPPONENT THINKING'}</b>${pot?`<div class="pot">POT × ${pot}</div>`:''}</div>`
}
function duelVersus(result,rightLabel='CPU'){
  const state=result.winner===null?'tie':result.winner===0?'you-win':'rival-win',winner=result.winner===null?null:result.cards[result.winner],verdict=result.winner===null?'STANDOFF':result.winner===0?'YOU WIN THE DUEL':`${rightLabel} WINS THE DUEL`;
  return `<div class="versus reveal-versus ${state}">
    <div class="duel-attribute"><i>${ATTRIBUTE_UI[result.attribute]?.icon||'◆'}</i><span>${result.attribute} DUEL</span></div>
    <div class="duel-scoreline"><div><small>YOU</small><b class="score-value" data-target="${result.values[0]}">0</b></div><i>VS</i><div><small>${rightLabel}</small><b class="score-value" data-target="${result.values[1]}">0</b></div></div>
    <div class="duel-verdict">${verdict}</div>
    <div class="duel-winner-name">${winner?escapeHtml(winner.name):'THE POT GROWS'}</div>
  </div>`
}
function animateDuelScores(){
  const els=[...document.querySelectorAll('.score-value')];if(!els.length)return;
  const start=performance.now(),duration=720;
  const tick=now=>{const p=Math.min(1,(now-start)/duration),ease=1-Math.pow(1-p,3);els.forEach(el=>el.textContent=Math.round(Number(el.dataset.target||0)*ease));if(p<1)requestAnimationFrame(tick)};
  requestAnimationFrame(tick)
}
function renderBattle(){
  if(!game)return menu();if(game.finished)return finish();
  const reveal=game.phase==='reveal',result=game.result;
  const p=reveal?result.cards[0]:game.decks[0][0],o=reveal?result.cards[1]:game.decks[1][0];
  const canChoose=!reveal&&game.active===0,legal=legalAttributes(game),disabled=ATTRIBUTES.filter(a=>!legal.includes(a));
  const status=outcomeText(result),roundClass=reveal?(result.winner===null?'is-tie':result.winner===0?'is-win':'is-loss'):'',phaseClass=reveal?'reveal-phase':'choose-phase';
  const pOutcome=reveal?(result.winner===null?'tie':result.winner===0?'winner':'loser'):null,oOutcome=reveal?(result.winner===null?'tie':result.winner===1?'winner':'loser'):null;
  const banner=reveal?`${result.attribute.toUpperCase()} LOCKED • ROUND RESOLVED`:canChoose?'YOUR TURN • CHOOSE AN ATTRIBUTE':'CPU IS SCANNING THE MATCHUP';
  app.innerHTML=nav()+`<main class="arena ${roundClass} ${phaseClass}">
    <div class="arena-atmosphere"><i></i><i></i><i></i></div>
    ${battleHud(game.decks[0].length,game.decks[1].length,'CPU',game.round,game.maxRounds,game.mode,game.pot.length*2)}
    <div class="turn-banner ${canChoose?'your-turn':''} ${reveal?'result-banner':''}">${banner}</div>
    <section class="table">
      <div class="player-slot">${card(p,{interactive:canChoose,selected:result?.attribute,slot:'player',disabledAttrs:disabled,outcome:pOutcome})}${game.mode===MODES.tactical&&!reveal?`<button class="swap" id="swap" ${!canChoose||!game.swaps[0]||game.decks[0].length<2?'disabled':''}>Reserve swap <b>${game.swaps[0]}</b></button>`:''}</div>
      ${reveal?duelVersus(result,'CPU'):idleVersus(canChoose,game.pot.length*2)}
      <div class="opponent-slot">${card(o,{hidden:!reveal,interactive:false,selected:result?.attribute,slot:'opponent',outcome:oOutcome,reveal})}</div>
    </section>
    <aside class="battle-log"><h3>Battle telemetry</h3>${historyHtml()}</aside>
    <div id="announcer" class="sr-only" aria-live="assertive">${status}</div>
  </main>`;
  bindNav();if(reveal)animateDuelScores();
  if(canChoose)document.querySelectorAll('[data-stat]').forEach(b=>b.onclick=()=>choose(b.dataset.stat));
  const sw=$('#swap');if(sw)sw.onclick=()=>doSwap();
  preload(game.decks[0][1]?.image);preload(game.decks[1][1]?.image)
}
function choose(attribute){
  if(!game||game.finished||game.phase!=='choose'||game.active!==0)return;
  ensureAudio();sfx('select');
  try{const r=resolveRound(game,attribute,0);sfx('reveal');schedule(()=>roundSound(r),650);renderBattle();schedule(afterReveal,REVEAL_HOLD_MS)}catch(e){console.warn(e)}
}
function doSwap(){
  try{reserveSwap(game,0);sfx('swap');renderBattle()}catch(e){console.warn(e)}
}
function roundSound(r){sfx(r.winner===null?'tie':r.winner===0?'win':'lose')}
function afterReveal(){
  if(!game||game.finished)return;advanceMatch(game);if(game.finished)return finish();renderBattle();if(game.active===1)scheduleCpu()
}
function scheduleCpu(){
  if(!game||game.finished||game.phase!=='choose'||game.active!==1)return;
  schedule(()=>{
    if(!game||game.finished||game.phase!=='choose'||game.active!==1)return;
    const banned=game.mode===MODES.tactical?game.lastAttribute:null;
    let chosen=chooseCpuAttribute(game.decks[1][0],cards,banned);
    const strength=attributeWinRate(game.decks[1][0],chosen,cards);
    if(game.mode===MODES.tactical&&game.swaps[1]&&game.decks[1].length>1&&strength<.42){
      reserveSwap(game,1);sfx('swap');renderBattle();chosen=chooseCpuAttribute(game.decks[1][0],cards,banned)
    }
    const r=resolveRound(game,chosen,1);sfx('reveal');schedule(()=>roundSound(r),650);renderBattle();schedule(afterReveal,REVEAL_HOLD_MS)
  },CPU_THINK_MS)
}
function finish(){
  if(!game)return menu();const out=game.outcome||finishMatch(game),state=out.winner===0?'win':out.winner===1?'loss':'draw';
  const title=state==='win'?'Arena conquered':state==='loss'?'Defeat':'Dead even';
  const copy=state==='win'?'Your reads converted into captures.':state==='loss'?'Review the battle log and run it back.':'The final card count is tied.';
  if(state==='win')sfx('final');else sfx(state==='loss'?'lose':'tie');
  const particles=state==='win'?`<div class="particles" aria-hidden="true">${Array.from({length:22},(_,i)=>`<i style="--i:${i}"></i>`).join('')}</div>`:'';
  app.innerHTML=nav()+`<main class="result ${state}">${particles}<div class="trophy">${state==='win'?'♛':state==='loss'?'◇':'='}</div><small>${game.mode.toUpperCase()} • ${out.roundsPlayed} ROUNDS</small><h1>${title}</h1><p>${copy}</p><div class="score"><span>YOU <b>${out.counts[0]}</b></span><i>—</i><span><b>${out.counts[1]}</b> CPU</span></div><div class="result-actions"><button class="primary" id="again">Rematch</button><button data-go="menu">Main menu</button></div></main>`;
  $('#again').onclick=()=>start(game.mode);bindNav()
}

function gallery(){
  screen='gallery';const tribes=[...new Set(cards.map(c=>c.tribe||'Unaligned'))].sort();
  app.innerHTML=nav()+`<main class="collection"><div class="collection-title"><div><small>COLLECTION & GAME STATS • ${cards.length} PLAYABLE</small><h1>Meet the Chimpions</h1><p class="collection-source">The official gallery API currently exposes ${cards.length} playable Chimpions. Game stats are balanced attributes, not NFT rarity rankings.</p></div><div class="filters"><input id="search" placeholder="Search name or tribe" aria-label="Search collection"><select id="tribe"><option value="">All tribes</option>${tribes.map(t=>`<option>${escapeHtml(t)}</option>`).join('')}</select><select id="sort"><option value="id">Number</option><option value="name">Name</option>${ATTRIBUTES.map(a=>`<option value="${a}">${a}</option>`).join('')}</select></div></div><div class="grid" id="grid"></div><dialog id="detail"><button class="close" aria-label="Close">×</button><div id="detailBody"></div></dialog></main>`;
  const draw=()=>{
    const q=$('#search').value.toLowerCase(),tribe=$('#tribe').value,sort=$('#sort').value;
    let list=cards.filter(c=>(c.name+' '+(c.tribe||'')).toLowerCase().includes(q)&&(!tribe||c.tribe===tribe));
    list=[...list].sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):ATTRIBUTES.includes(sort)?b.stats[sort]-a.stats[sort]:Number(a.id)-Number(b.id));
    $('#grid').innerHTML=list.length?list.map(c=>`<button class="tile" data-id="${c.id}"><img loading="lazy" src="${c.image}" alt="${escapeHtml(c.name)}"><b>${escapeHtml(c.name)}</b><span>${escapeHtml(c.tribe||'Unaligned')}</span><em>${Math.max(...Object.values(c.stats))} top stat</em></button>`).join(''):`<div class="empty-search">No Chimpions match these filters.</div>`;
    bindImages();document.querySelectorAll('.tile').forEach(t=>t.onclick=()=>showDetail(t.dataset.id))
  };
  $('#search').oninput=draw;$('#tribe').onchange=draw;$('#sort').onchange=draw;$('#detail .close').onclick=()=>$('#detail').close();draw();bindNav()
}
function showDetail(id){const c=cards.find(x=>String(x.id)===String(id));if(!c)return;$('#detailBody').innerHTML=`<div class="detail-art"><img src="${c.image}" alt="${escapeHtml(c.name)}"></div><div><small>#${String(c.id).padStart(3,'0')} • ${escapeHtml(c.tribe||'Unaligned')}</small><h2>${escapeHtml(c.name)}</h2><div class="detail-stats">${ATTRIBUTES.map(a=>`<div><span>${a}</span><b>${c.stats[a]}</b><i style="--v:${c.stats[a]}%"></i></div>`).join('')}</div></div>`;bindImages();$('#detail').showModal()}

function help(){app.innerHTML=nav()+`<main class="copy"><small>30-SECOND GUIDE</small><h1>How to play</h1><ol><li>Study your visible Chimpion and choose one of its six game stats.</li><li>The rival card reveals. The higher value wins both cards.</li><li>A tie creates a standoff pot. The next decisive winner claims everything.</li><li><b>Classic:</b> the round winner chooses the next attribute; a tie keeps initiative.</li><li><b>Tactical:</b> initiative alternates every round, the last attribute cannot be repeated, and each player gets one reserve swap.</li><li>If the round limit or deck exhaustion arrives with an unresolved pot, tied cards return to their original owners before final scoring.</li></ol><p>Game stats use an equal deterministic budget. They are not rarity, price, or official collection rankings.</p><button class="primary" id="go">Enter the arena</button></main>`;$('#go').onclick=()=>start();bindNav()}

function online(defaultMode=MODES.tactical){
  cleanup();screen='online';
  app.innerHTML=nav()+`<main class="copy online-copy"><small>SERVER-AUTHORITATIVE PRIVATE ROOM</small><h1>Challenge a friend</h1><p>Create a four-letter room code or enter one shared by a friend. A disconnected player ends the room; stalled turns auto-resolve after the visible timer.</p><fieldset class="mode-picker compact"><legend>Room rules</legend><label><input type="radio" name="mode" value="classic" ${defaultMode==='classic'?'checked':''}><span><b>Classic</b></span></label><label><input type="radio" name="mode" value="tactical" ${defaultMode==='tactical'?'checked':''}><span><b>Tactical</b></span></label></fieldset><div class="room"><button class="primary" id="create">Create room</button><input id="code" maxlength="4" autocomplete="off" placeholder="CODE" aria-label="Room code"><button id="join">Join</button></div><div id="status" aria-live="polite">Connecting…</div></main>`;bindNav();
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/room`);
  socket.onopen=()=>setStatus('Connected — create or join a room.');
  socket.onerror=()=>setStatus('Connection problem. Check the server and try again.');
  socket.onclose=()=>{if(screen==='online'&&$('#status'))setStatus('Connection closed. Return to the menu to reconnect.')};
  socket.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}handleNet(m)};
  $('#create').onclick=()=>sendWs({type:'create',mode:currentMode()});$('#join').onclick=()=>sendWs({type:'join',code:$('#code').value.trim().toUpperCase()});
}
function setStatus(t){const el=$('#status');if(el)el.textContent=t}
function sendWs(payload){if(!socket||socket.readyState!==WebSocket.OPEN)return setStatus('Still connecting — try again in a moment.');socket.send(JSON.stringify(payload))}
function handleNet(m){
  if(m.type==='room')return setStatus(`Room ${m.code} — waiting for your friend…`);
  if(m.type==='ready')return setStatus(`Room ${m.code} ready. ${m.mode.toUpperCase()} rules.`);
  if(m.type==='state'){netState=m;return netBattle(m)}
  if(m.type==='reveal')return netReveal(m);
  if(m.type==='gameover')return netGameOver(m);
  if(m.type==='left'){netState=null;return setStatus('Opponent disconnected. This room is closed; create a new room for a rematch.')}
  if(m.type==='error')return setStatus(m.message)
}
function deadlineMarkup(deadline){return deadline?`<span class="deadline">TURN <b id="turnTimer">--</b>s</span>`:''}
function startDeadline(deadline){if(!deadline)return;const draw=()=>{const el=$('#turnTimer');if(el)el.textContent=Math.max(0,Math.ceil((deadline-Date.now())/1000))};draw();every(draw,250)}
function netBattle(m){
  screen='online';for(const id of intervals)clearInterval(id);intervals.clear();const legal=m.legal||ATTRIBUTES,disabled=ATTRIBUTES.filter(a=>!legal.includes(a));
  app.innerHTML=nav()+`<main class="arena choose-phase"><div class="arena-atmosphere"><i></i><i></i><i></i></div>
    ${battleHud(m.counts[0],m.counts[1],'RIVAL',m.round,m.maxRounds,m.mode,m.pot)}
    <div class="turn-banner ${m.turn?'your-turn':''}">${m.turn?'YOUR TURN • CHOOSE AN ATTRIBUTE':'RIVAL IS CHOOSING'} ${deadlineMarkup(m.deadline)}</div>
    <section class="table"><div class="player-slot">${card(m.card,{interactive:m.turn,slot:'player',disabledAttrs:disabled})}${m.mode===MODES.tactical?`<button class="swap" id="netSwap" ${!m.turn||!m.swaps?.[0]?'disabled':''}>Reserve swap <b>${m.swaps?.[0]||0}</b></button>`:''}</div>
    ${idleVersus(m.turn,m.pot)}
    <div class="opponent-slot">${card(null,{hidden:true,slot:'opponent'})}</div></section><div id="announcer" class="sr-only" aria-live="assertive">${m.turn?'Your move':'Opponent turn'}</div></main>`;bindNav();
  if(m.turn)document.querySelectorAll('[data-stat]').forEach(b=>b.onclick=()=>{sfx('select');sendWs({type:'action',action:b.dataset.stat})});
  const sw=$('#netSwap');if(sw)sw.onclick=()=>sendWs({type:'swap'});startDeadline(m.deadline)
}
function netReveal(m){
  for(const id of intervals)clearInterval(id);intervals.clear();const winner=m.winner===null?null:m.winner==='you'?0:1,cls=winner===null?'is-tie':winner===0?'is-win':'is-loss',status=winner===null?'STANDOFF':winner===0?'YOU WIN':'RIVAL WINS',result={cards:m.cards,values:m.values,attribute:m.attribute,winner};
  sfx('reveal');schedule(()=>sfx(winner===null?'tie':winner===0?'win':'lose'),650);
  const counts=m.counts||netState?.counts||['—','—'],round=m.round||netState?.round||'—',maxRounds=m.maxRounds||netState?.maxRounds||24,mode=m.mode||netState?.mode||MODES.tactical;
  app.innerHTML=nav()+`<main class="arena ${cls} reveal-phase"><div class="arena-atmosphere"><i></i><i></i><i></i></div>
    ${battleHud(counts[0],counts[1],'RIVAL',round,maxRounds,mode,m.pot||0)}
    <div class="turn-banner result-banner">${m.attribute.toUpperCase()} LOCKED • ROUND RESOLVED</div>
    <section class="table"><div class="player-slot">${card(m.cards[0],{selected:m.attribute,slot:'player',outcome:winner===null?'tie':winner===0?'winner':'loser'})}</div>
    ${duelVersus(result,'RIVAL')}
    <div class="opponent-slot">${card(m.cards[1],{selected:m.attribute,slot:'opponent',outcome:winner===null?'tie':winner===1?'winner':'loser',reveal:true})}</div></section>
    <div id="announcer" class="sr-only" aria-live="assertive">${status}</div></main>`;bindNav();animateDuelScores()
}
function netGameOver(m){
  const state=m.winner==='you'?'win':m.winner==='draw'?'draw':'loss',title=state==='win'?'Victory':state==='draw'?'Draw':'Defeat';
  if(state==='win')sfx('final');else sfx(state==='draw'?'tie':'lose');
  app.innerHTML=nav()+`<main class="result ${state}"><div class="trophy">${state==='win'?'♛':state==='draw'?'=':'◇'}</div><h1>${title}</h1><p>Final count: ${m.counts[0]} to ${m.counts[1]}.</p><div class="result-actions"><button class="primary" id="onlineAgain">New room</button><button data-go="menu">Main menu</button></div></main>`;$('#onlineAgain').onclick=()=>online(m.mode||MODES.tactical);bindNav()
}

fetch('/data/chimpions.json').then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}).then(d=>{manifest=d;cards=decorateCards(d.cards||[]);menu()}).catch(()=>app.innerHTML='<main class="result loss"><h1>Collection unavailable</h1><p>Refresh to try again.</p></main>');
