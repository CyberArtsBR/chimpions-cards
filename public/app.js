import {
  ATTRIBUTES,MODES,createMatch,legalAttributes,resolveRound,advanceMatch,finishMatch,
  reserveSwap,chooseCpuAttribute,attributeWinRate,decorateCards,validateCollection
} from './engine.js';

const $=s=>document.querySelector(s),app=$('#app');
let cards=[],manifest=null,game=null,screen='menu',epoch=0,socket=null,netState=null;
const timers=new Set(),intervals=new Set();
const prefs={sfx:localStorage.getItem('chimpions:sfx')!=='off',music:localStorage.getItem('chimpions:music')!=='off'};
let audioCtx=null,musicInterval=null,musicStep=0;

const placeholder=`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#111527"/><circle cx="300" cy="260" r="120" fill="#242b45"/><text x="300" y="300" text-anchor="middle" font-family="sans-serif" font-size="128" font-weight="800" fill="#c8ff42">C</text><text x="300" y="450" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#aeb5cc">CHIMPION</text></svg>`)}`;

function schedule(fn,ms){const e=epoch,id=setTimeout(()=>{timers.delete(id);if(e===epoch)fn()},ms);timers.add(id);return id}
function every(fn,ms){const e=epoch,id=setInterval(()=>{if(e===epoch)fn();else{clearInterval(id);intervals.delete(id)}},ms);intervals.add(id);return id}
function cleanup({closeSocket=true}={}){
  epoch++; for(const id of timers)clearTimeout(id);timers.clear();for(const id of intervals)clearInterval(id);intervals.clear();
  if(closeSocket&&socket){try{socket.close()}catch{}socket=null;netState=null}
}
function go(name){cleanup();screen=name;({menu,gallery,help,online}[name]||menu)()}

function ensureAudio(){
  if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
  if(prefs.music&&!musicInterval){musicInterval=setInterval(musicBeat,1400)}
}
function tone(freq,duration=.12,gain=.035,type='sine',delay=0){
  if(!audioCtx)return;const t=audioCtx.currentTime+delay,o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g).connect(audioCtx.destination);o.start(t);o.stop(t+duration+.03)
}
function sfx(type){if(!prefs.sfx)return;ensureAudio();const map={ui:[520],select:[420,620],win:[440,660,880],lose:[260,190],tie:[330,330],swap:[520,390],final:[523,659,784,1047]};(map[type]||map.ui).forEach((f,i)=>tone(f,.13,.04,'triangle',i*.08))}
function musicBeat(){if(!prefs.music||!audioCtx||audioCtx.state!=='running')return;const notes=[110,138.59,164.81,138.59];tone(notes[musicStep++%notes.length],.55,.012,'sine')}
function toggleAudio(kind){prefs[kind]=!prefs[kind];localStorage.setItem(`chimpions:${kind}`,prefs[kind]?'on':'off');ensureAudio();if(!prefs.music&&musicInterval){clearInterval(musicInterval);musicInterval=null}renderAudioButtons()}
function renderAudioButtons(){const s=$('#sfxToggle'),m=$('#musicToggle');if(s){s.textContent=prefs.sfx?'SFX ON':'SFX OFF';s.setAttribute('aria-pressed',String(prefs.sfx))}if(m){m.textContent=prefs.music?'MUSIC ON':'MUSIC OFF';m.setAttribute('aria-pressed',String(prefs.music))}}

function nav(){return `<header><button class="brand" data-go="menu"><b>CHIMPIONS</b><span>ATTRIBUTE ARENA</span></button><nav><button data-go="gallery">Collection</button><button data-go="help">How to play</button><button class="audio-toggle" id="musicToggle" aria-label="Toggle music"></button><button class="audio-toggle" id="sfxToggle" aria-label="Toggle sound effects"></button></nav></header>`}
function bindNav(){
  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  const s=$('#sfxToggle'),m=$('#musicToggle');if(s)s.onclick=()=>toggleAudio('sfx');if(m)m.onclick=()=>toggleAudio('music');renderAudioButtons();bindImages();
}
function bindImages(){document.querySelectorAll('img').forEach(img=>{img.addEventListener('error',()=>{if(img.src!==placeholder)img.src=placeholder},{once:true})})}
function preload(url){if(!url)return;const i=new Image();i.src=url}
function currentMode(){return document.querySelector('[name="mode"]:checked')?.value||MODES.tactical}

function menu(){
  screen='menu';
  const v=manifest?validateCollection(manifest):null;
  const collectionNote=v&&v.expected&&v.count!==v.expected?`<div class="notice">Official API snapshot: ${v.count}/${v.expected} advertised Chimpions available. Gameplay uses every API card; collection-wide balance remains provisional until the source discrepancy is resolved.</div>`:'';
  app.innerHTML=nav()+`<main class="hero"><div class="hero-copy"><div class="eyebrow">1/1 ANIMATED CHIMPIONS • COMPETITIVE CARD BATTLE</div><h1>Every Chimpion<br><em>has a way to win.</em></h1><p>Read the matchup, pick the edge, and claim the standoff pot.</p><fieldset class="mode-picker"><legend>Ruleset</legend><label><input type="radio" name="mode" value="classic"><span><b>Classic</b><small>Traditional • winner chooses next</small></span></label><label><input type="radio" name="mode" value="tactical" checked><span><b>Tactical ★</b><small>Recommended • alternating turns • no repeat • 1 reserve swap</small></span></label></fieldset><div class="actions"><button class="primary" id="quick">Play vs CPU</button><button id="onlineBtn">Private 1v1</button></div><div class="features"><span>⚡ 5–8 min matches</span><span>◆ Equal stat budget</span><span>◎ Animated originals</span></div>${collectionNote}</div><div class="hero-card-stack" aria-hidden="true"><div class="mini-card mc1">POWER</div><div class="mini-card mc2">MYSTIQUE</div><div class="mini-card mc3">TECH</div></div></main>`;
  $('#quick').onclick=()=>{ensureAudio();sfx('ui');start(currentMode())};$('#onlineBtn').onclick=()=>{ensureAudio();sfx('ui');cleanup();online(currentMode())};bindNav()
}

function start(mode=MODES.tactical){
  cleanup();screen='battle';ensureAudio();
  const starter=Math.random()<.5?0:1;
  game=createMatch(cards,{deckSize:6,maxRounds:24,mode,starter});
  renderBattle();sfx('ui');if(game.active===1)scheduleCpu();
}
function statMarkup(c,a,interactive,selected,disabled){
  const tag=interactive?'button':'div',attrs=interactive?`data-stat="${a}" ${disabled?'disabled':''}`:'';
  return `<${tag} class="stat ${selected===a?'selected':''} ${disabled?'locked':''}" ${attrs}><span>${a}</span><b>${c.stats[a]}</b><i style="--v:${c.stats[a]}%"></i></${tag}>`
}
function card(c,{hidden=false,interactive=false,selected=null,slot='player',disabledAttrs=[]}={}){
  if(hidden)return `<article class="card back ${slot}"><div class="sigil">C</div><b>HIDDEN CHIMPION</b><small>Opponent card reveals after a choice</small></article>`;
  if(!c)return '';
  return `<article class="card ${slot}"><div class="art"><img src="${c.image}" alt="${escapeHtml(c.name)}" loading="eager"><span>${escapeHtml(c.tribe||'Unaligned')}</span></div><div class="cardhead"><small>#${String(c.id).padStart(3,'0')}</small><h2>${escapeHtml(c.name)}</h2></div><div class="stats">${ATTRIBUTES.map(a=>statMarkup(c,a,interactive,selected,disabledAttrs.includes(a))).join('')}</div></article>`
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
function renderBattle(){
  if(!game)return menu();if(game.finished)return finish();
  const reveal=game.phase==='reveal',result=game.result;
  const p=reveal?result.cards[0]:game.decks[0][0],o=reveal?result.cards[1]:game.decks[1][0];
  const canChoose=!reveal&&game.active===0,legal=legalAttributes(game),disabled=ATTRIBUTES.filter(a=>!legal.includes(a));
  const status=outcomeText(result),roundClass=reveal?(result.winner===null?'is-tie':result.winner===0?'is-win':'is-loss'):'';
  app.innerHTML=nav()+`<main class="arena ${roundClass}"><div class="hud"><span>YOU <b>${game.decks[0].length}</b></span><span>ROUND ${game.round}/${game.maxRounds}<small>${game.pot.length?`STANDOFF POT ${game.pot.length*2}`:game.mode.toUpperCase()}</small></span><span><b>${game.decks[1].length}</b> CPU</span></div><div class="turn-banner ${canChoose?'your-turn':''}">${status}</div><section class="table"><div class="player-slot">${card(p,{interactive:canChoose,selected:result?.attribute,slot:'player',disabledAttrs:disabled})}${game.mode===MODES.tactical&&!reveal?`<button class="swap" id="swap" ${!canChoose||!game.swaps[0]||game.decks[0].length<2?'disabled':''}>Reserve swap <b>${game.swaps[0]}</b></button>`:''}</div><div class="versus"><b>${reveal?`${result.values[0]}<i>VS</i>${result.values[1]}`:'VS'}</b><span>${reveal?result.attribute:(canChoose?'PICK AN EDGE':'WAITING')}</span>${game.pot.length?`<div class="pot">POT × ${game.pot.length*2}</div>`:''}</div><div class="opponent-slot">${card(o,{hidden:!reveal,interactive:false,selected:result?.attribute,slot:'opponent'})}</div></section><aside class="battle-log"><h3>Battle history</h3>${historyHtml()}</aside><div id="announcer" class="sr-only" aria-live="assertive">${status}</div></main>`;
  bindNav();
  if(canChoose)document.querySelectorAll('[data-stat]').forEach(b=>b.onclick=()=>choose(b.dataset.stat));
  const sw=$('#swap');if(sw)sw.onclick=()=>doSwap();
  preload(game.decks[0][1]?.image);preload(game.decks[1][1]?.image)
}
function choose(attribute){
  if(!game||game.finished||game.phase!=='choose'||game.active!==0)return;
  ensureAudio();sfx('select');
  try{const r=resolveRound(game,attribute,0);roundSound(r);renderBattle();schedule(afterReveal,1350)}catch(e){console.warn(e)}
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
    const r=resolveRound(game,chosen,1);roundSound(r);renderBattle();schedule(afterReveal,1350)
  },700)
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
  app.innerHTML=nav()+`<main class="collection"><div class="collection-title"><div><small>COLLECTION & GAME STATS</small><h1>Meet the Chimpions</h1></div><div class="filters"><input id="search" placeholder="Search name or tribe" aria-label="Search collection"><select id="tribe"><option value="">All tribes</option>${tribes.map(t=>`<option>${escapeHtml(t)}</option>`).join('')}</select><select id="sort"><option value="id">Number</option><option value="name">Name</option>${ATTRIBUTES.map(a=>`<option value="${a}">${a}</option>`).join('')}</select></div></div><div class="grid" id="grid"></div><dialog id="detail"><button class="close" aria-label="Close">×</button><div id="detailBody"></div></dialog></main>`;
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
  app.innerHTML=nav()+`<main class="arena"><div class="hud"><span>YOU <b>${m.counts[0]}</b></span><span>ROUND ${m.round}/${m.maxRounds}<small>${m.pot?`STANDOFF POT ${m.pot}`:m.mode.toUpperCase()}</small></span><span><b>${m.counts[1]}</b> RIVAL</span></div><div class="turn-banner ${m.turn?'your-turn':''}">${m.turn?'YOUR MOVE':'RIVAL IS CHOOSING'} ${deadlineMarkup(m.deadline)}</div><section class="table"><div class="player-slot">${card(m.card,{interactive:m.turn,slot:'player',disabledAttrs:disabled})}${m.mode===MODES.tactical?`<button class="swap" id="netSwap" ${!m.turn||!m.swaps?.[0]?'disabled':''}>Reserve swap <b>${m.swaps?.[0]||0}</b></button>`:''}</div><div class="versus"><b>VS</b><span>${m.turn?'PICK AN EDGE':'WAITING'}</span>${m.pot?`<div class="pot">POT × ${m.pot}</div>`:''}</div><div class="opponent-slot">${card(null,{hidden:true,slot:'opponent'})}</div></section><div id="announcer" class="sr-only" aria-live="assertive">${m.turn?'Your move':'Opponent turn'}</div></main>`;bindNav();
  if(m.turn)document.querySelectorAll('[data-stat]').forEach(b=>b.onclick=()=>{sfx('select');sendWs({type:'action',action:b.dataset.stat})});
  const sw=$('#netSwap');if(sw)sw.onclick=()=>sendWs({type:'swap'});startDeadline(m.deadline)
}
function netReveal(m){
  for(const id of intervals)clearInterval(id);intervals.clear();const cls=m.winner===null?'is-tie':m.winner==='you'?'is-win':'is-loss',status=m.winner===null?'STANDOFF':m.winner==='you'?'YOU WIN':'RIVAL WINS';sfx(m.winner===null?'tie':m.winner==='you'?'win':'lose');
  app.innerHTML=nav()+`<main class="arena ${cls}"><div class="hud"><span>YOU</span><span>${m.attribute}<small>${m.pot?`STANDOFF POT ${m.pot}`:''}</small></span><span>RIVAL</span></div><div class="turn-banner">${status} — ${m.values[0]} vs ${m.values[1]}</div><section class="table"><div class="player-slot">${card(m.cards[0],{selected:m.attribute,slot:'player'})}</div><div class="versus"><b>${m.values[0]}<i>VS</i>${m.values[1]}</b><span>${m.attribute}</span></div><div class="opponent-slot">${card(m.cards[1],{selected:m.attribute,slot:'opponent'})}</div></section><div id="announcer" class="sr-only" aria-live="assertive">${status}</div></main>`;bindNav()
}
function netGameOver(m){
  const state=m.winner==='you'?'win':m.winner==='draw'?'draw':'loss',title=state==='win'?'Victory':state==='draw'?'Draw':'Defeat';
  if(state==='win')sfx('final');else sfx(state==='draw'?'tie':'lose');
  app.innerHTML=nav()+`<main class="result ${state}"><div class="trophy">${state==='win'?'♛':state==='draw'?'=':'◇'}</div><h1>${title}</h1><p>Final count: ${m.counts[0]} to ${m.counts[1]}.</p><div class="result-actions"><button class="primary" id="onlineAgain">New room</button><button data-go="menu">Main menu</button></div></main>`;$('#onlineAgain').onclick=()=>online(m.mode||MODES.tactical);bindNav()
}

fetch('/data/chimpions.json').then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}).then(d=>{manifest=d;cards=decorateCards(d.cards||[]);menu()}).catch(()=>app.innerHTML='<main class="result loss"><h1>Collection unavailable</h1><p>Refresh to try again.</p></main>');
