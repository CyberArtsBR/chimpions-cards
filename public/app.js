import {
  ATTRIBUTES,MODES,MODE_META,CPU_DIFFICULTIES,createMatch,legalAttributes,legalWagers,resolveRound,advanceMatch,finishMatch,
  reserveSwap,setBan,chooseCpuAttribute,chooseCpuAttributes,chooseCpuBan,chooseCpuWager,attributeWinRate,decorateCards,validateCollection
} from './engine.js';

const $=s=>document.querySelector(s),app=$('#app');
let cards=[],manifest=null,game=null,screen='menu',epoch=0,socket=null,netState=null;
const timers=new Set(),intervals=new Set();
const REVEAL_HOLD_NORMAL_MS=3200,REVEAL_HOLD_FAST_MS=1800,CPU_THINK_MS=900;
const prefs={
  sfx:localStorage.getItem('chimpions:sfx')!=='off',
  music:localStorage.getItem('chimpions:music')!=='off',
  fast:localStorage.getItem('chimpions:pace')==='fast',
  difficulty:CPU_DIFFICULTIES.expert,
  motion:localStorage.getItem('chimpions:motion')||'auto'
};
let audioCtx=null,battleTrack=null,battleMusicUnlockArmed=false,roundAdvanceTimer=null,cpuDifficulty=prefs.difficulty,battleIntroPending=false;
let selectedMode=Object.values(MODES).includes(localStorage.getItem('chimpions:mode'))?localStorage.getItem('chimpions:mode'):MODES.tactical;
let selectedTriple=[],selectedWager=1;

const placeholder=`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#111527"/><circle cx="300" cy="260" r="120" fill="#242b45"/><text x="300" y="300" text-anchor="middle" font-family="sans-serif" font-size="128" font-weight="800" fill="#c8ff42">C</text><text x="300" y="450" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#aeb5cc">CHIMPION</text></svg>`)}`;

function schedule(fn,ms){const e=epoch,id=setTimeout(()=>{timers.delete(id);if(e===epoch)fn()},ms);timers.add(id);return id}
function every(fn,ms){const e=epoch,id=setInterval(()=>{if(e===epoch)fn();else{clearInterval(id);intervals.delete(id)}},ms);intervals.add(id);return id}
function cleanup({closeSocket=true}={}){
  epoch++; for(const id of timers)clearTimeout(id);timers.clear();for(const id of intervals)clearInterval(id);intervals.clear();roundAdvanceTimer=null;document.onkeydown=null;
  stopBattleMusic(true);
  if(closeSocket&&socket){try{socket.close()}catch{}socket=null;netState=null}
}
function go(name){cleanup();screen=name;({menu,gallery,help,online}[name]||menu)()}

function ensureAudio(){
  if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
}
function tone(freq,duration=.12,gain=.035,type='sine',delay=0){
  if(!audioCtx)return;const t=audioCtx.currentTime+delay,o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.018);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g).connect(audioCtx.destination);o.start(t);o.stop(t+duration+.04)
}
function sfx(type){
  if(!prefs.sfx)return;ensureAudio();
  const map={ui:[520],select:[360,620,920],reveal:[150,300,600],win:[440,660,880,1320],lose:[240,180,120],tie:[330,440,330],swap:[520,390],final:[523,659,784,1047,1318]};
  (map[type]||map.ui).forEach((freq,i)=>tone(freq,type==='reveal'?.2:.15,type==='final'?.05:.042,i%2?'triangle':'sine',i*.065))
}
const BATTLE_THEME_URL='/audio/battle-theme.mp3',BATTLE_MUSIC_VOLUME=.14;
const ARENA_VIDEO_URL='/video/crowd-and-flag.mp4';
const OFFICIAL_LINKS={
  site:'https://www.chimpions.co/',
  x:'https://x.com/TheChimpions',
  discord:'https://discord.gg/thechimpions'
};
function ensureBattleTrack(){
  if(!battleTrack){
    battleTrack=new Audio(BATTLE_THEME_URL);battleTrack.loop=true;battleTrack.preload='auto';battleTrack.volume=BATTLE_MUSIC_VOLUME;
    battleTrack.addEventListener('error',()=>console.warn('Battle theme failed to load.'));
  }
  return battleTrack
}
function armBattleMusicUnlock(){
  if(!prefs.music||battleMusicUnlockArmed)return;
  battleMusicUnlockArmed=true;
  const unlock=()=>{
    battleMusicUnlockArmed=false;window.removeEventListener('pointerdown',unlock,true);window.removeEventListener('keydown',unlock,true);
    if(screen==='battle'||(screen==='online'&&netState))startBattleMusic()
  };
  window.addEventListener('pointerdown',unlock,{once:true,capture:true});window.addEventListener('keydown',unlock,{once:true,capture:true})
}
function startBattleMusic({restart=false}={}){
  if(!prefs.music)return;
  const t=ensureBattleTrack();t.loop=true;t.volume=BATTLE_MUSIC_VOLUME;
  if(restart){try{t.currentTime=0}catch{}}
  if(!t.paused&&!restart)return;
  const play=t.play();if(play?.catch)play.catch(()=>armBattleMusicUnlock())
}
function stopBattleMusic(reset=false){
  if(!battleTrack)return;battleTrack.pause();if(reset){try{battleTrack.currentTime=0}catch{}}
}
function toggleAudio(kind){
  prefs[kind]=!prefs[kind];localStorage.setItem(`chimpions:${kind}`,prefs[kind]?'on':'off');
  if(kind==='sfx'&&prefs.sfx)ensureAudio();
  if(kind==='music'){
    if(prefs.music&&(screen==='battle'||(screen==='online'&&netState)))startBattleMusic();
    else if(!prefs.music)stopBattleMusic(false)
  }
  renderAudioButtons()
}
function togglePace(){
  prefs.fast=!prefs.fast;localStorage.setItem('chimpions:pace',prefs.fast?'fast':'normal');renderAudioButtons()
}
function motionReduced(){
  if(prefs.motion==='reduced')return true;
  if(prefs.motion==='full')return false;
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}
function toggleMotion(){
  prefs.motion=prefs.motion==='auto'?'reduced':prefs.motion==='reduced'?'full':'auto';
  localStorage.setItem('chimpions:motion',prefs.motion);applyMotionPreference();renderAudioButtons()
}
function applyMotionPreference(){document.body.classList.toggle('reduce-motion',motionReduced());syncArenaVideo()}
function renderAudioButtons(){
  const s=$('#sfxToggle'),m=$('#musicToggle'),p=$('#paceToggle'),r=$('#motionToggle');
  if(s){s.textContent=prefs.sfx?'SFX ON':'SFX OFF';s.setAttribute('aria-pressed',String(prefs.sfx))}
  if(m){m.textContent=prefs.music?'MUSIC ON':'MUSIC OFF';m.setAttribute('aria-pressed',String(prefs.music))}
  if(p){p.textContent=prefs.fast?'PACE FAST':'PACE NORMAL';p.setAttribute('aria-pressed',String(prefs.fast))}
  if(r){r.textContent='MOTION '+prefs.motion.toUpperCase();r.setAttribute('aria-pressed',String(motionReduced()))}
}

function socialIcon(kind){
  const icons={
    site:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Zm6.9 9h-3.05a15.2 15.2 0 0 0-1.28-5.04A8.03 8.03 0 0 1 18.9 11ZM12 4.1c.74.9 1.83 3.12 2.12 6.9H9.88C10.17 7.22 11.26 5 12 4.1ZM9.43 5.96A15.2 15.2 0 0 0 8.15 11H5.1a8.03 8.03 0 0 1 4.33-5.04ZM5.1 13h3.05a15.2 15.2 0 0 0 1.28 5.04A8.03 8.03 0 0 1 5.1 13ZM12 19.9c-.74-.9-1.83-3.12-2.12-6.9h4.24c-.29 3.78-1.38 6-2.12 6.9Zm2.57-1.86A15.2 15.2 0 0 0 15.85 13h3.05a8.03 8.03 0 0 1-4.33 5.04Z"/></svg>`,
    x:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 3H21l-4.58 5.23L21.8 21h-4.22l-3.3-4.84L10.04 21H7.9l4.89-5.6L3 3h4.33l2.99 4.4L14.1 3Zm-.74 16h1.17L6.7 4.9H5.44Z"/></svg>`,
    discord:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.54 5.34A16.3 16.3 0 0 0 15.5 4l-.2.41a11.4 11.4 0 0 1 3.4 1.73a11.68 11.68 0 0 0-7.4 0a11.4 11.4 0 0 1 3.4-1.73L14.5 4a16.3 16.3 0 0 0-4.04 1.34C7.9 9.18 7.2 12.9 7.42 16.56A16.45 16.45 0 0 0 12.2 19l.76-1.26c-.8-.28-1.57-.68-2.28-1.18l.54-.41c1.39.65 2.95.65 4.34 0l.54.41c-.71.5-1.48.9-2.28 1.18l.76 1.26a16.45 16.45 0 0 0 4.78-2.44c.3-4.17-.52-7.87-2.82-11.22ZM10.2 14.33c-.85 0-1.54-.8-1.54-1.78c0-.98.68-1.78 1.54-1.78c.86 0 1.55.8 1.54 1.78c0 .98-.68 1.78-1.54 1.78Zm3.6 0c-.85 0-1.54-.8-1.54-1.78c0-.98.68-1.78 1.54-1.78c.86 0 1.55.8 1.54 1.78c0 .98-.68 1.78-1.54 1.78Z"/></svg>`
  };
  return icons[kind]||''
}
function officialLinks(compact=false){
  return `<div class="${compact?'nav-socials':'official-links'}">
    <a class="official-site" href="${OFFICIAL_LINKS.site}" target="_blank" rel="noreferrer" aria-label="Official Chimpions website">${socialIcon('site')}<strong>${compact?'Official Chimpions Website':'Official Chimpions Website'}</strong></a>
    <a class="official-x" href="${OFFICIAL_LINKS.x}" target="_blank" rel="noreferrer" aria-label="Chimpions on X">${socialIcon('x')}<strong>${compact?'X / TheChimpions':'X / TheChimpions'}</strong></a>
    <a class="official-discord" href="${OFFICIAL_LINKS.discord}" target="_blank" rel="noreferrer" aria-label="Chimpions Discord">${socialIcon('discord')}<strong>Discord</strong></a>
  </div>`
}
// Keep the same media element through round renders so the crowd loop never restarts.
let arenaVideo=null;
function syncArenaVideo(){
  const host=document.querySelector('.arena-video');
  if(!host){arenaVideo?.pause();return}
  if(!arenaVideo){
    arenaVideo=document.createElement('video');
    arenaVideo.src=ARENA_VIDEO_URL;arenaVideo.poster='/video/arena-poster.jpg';arenaVideo.loop=true;arenaVideo.muted=true;
    arenaVideo.defaultMuted=true;arenaVideo.playsInline=true;arenaVideo.preload='auto';
    arenaVideo.setAttribute('aria-hidden','true');
  }
  if(arenaVideo.parentElement!==host){host.querySelector('video')?.remove();host.prepend(arenaVideo)}
  if(motionReduced()||document.hidden)arenaVideo.pause();
  else arenaVideo.play().catch(()=>{});
}
document.addEventListener('visibilitychange',syncArenaVideo);
document.addEventListener('pointerdown',()=>{if(arenaVideo?.paused)syncArenaVideo()});
function backgroundVideo(kind='battle'){
  return `<div class="arena-video arena-video-${kind}" aria-hidden="true">

    <div class="arena-video-color"></div>
    <div class="arena-video-vignette"></div>
  </div>`
}
function crest(){return `<svg class="arena-crest" viewBox="0 0 100 110" aria-hidden="true"><path d="M10 10 50 2 90 10V60L75 85 50 106 25 85 10 60Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M20 23 35 18 50 28 65 18 80 23 76 65 50 88 24 65Z" fill="currentColor" opacity=".16"/><path d="M26 40 34 30 43 36H57L66 30 74 40V61L63 73H37L26 61Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M35 47H43M57 47H65M43 62H57" stroke="currentColor" stroke-width="4"/><path d="M37 12 50 20 63 12" fill="none" stroke="currentColor" stroke-width="2"/></svg>`}
function settingsMarkup(){return `<button class="settings-open" aria-haspopup="dialog">Settings</button><dialog id="settingsDialog" aria-labelledby="settingsTitle"><button class="close" aria-label="Close settings">×</button><small class="eyebrow">MAKE IT YOUR ARENA</small><h2 id="settingsTitle">Settings</h2><div class="settings-options"><div><span>Music</span><button class="audio-toggle" id="musicToggle" aria-label="Toggle music"></button></div><div><span>Sound effects</span><button class="audio-toggle" id="sfxToggle" aria-label="Toggle sound effects"></button></div><div><span>Animation</span><button class="motion-toggle" id="motionToggle" aria-label="Cycle motion preference"></button></div>${screen==='battle'?'<div><span>Round pace</span><button class="pace-toggle" id="paceToggle" aria-label="Toggle reveal pace"></button></div>':''}</div><p>Motion follows your device in Auto mode. Reduced motion uses a still arena background.</p></dialog>`}
function nav(){
  const battle=screen==='battle'||screen==='online';
  const brand=battle?'<b>CHAMPIONS ARENA</b>':screen==='menu'?'<img class="brand-logo-img" src="/ui/logo-header.svg" alt="Chimpions">':'<b>CHIMPIONS</b><span>ARENA</span>';
  return `<${battle?'div class="battle-topbar"':'header'}><button class="brand" data-go="menu" aria-label="Champions Arena home">${brand}</button>${battle?'':officialLinks(true)}<nav>${battle?'<button data-go="menu">Main menu</button>':'<button data-go="menu">Play</button><button data-go="gallery">Collection</button><button data-go="help">How to play</button>'}${settingsMarkup()}</nav></${battle?'div':'header'}>`
}
function footer(){return `<footer class="site-footer"><span>THE CHIMPIONS ARENA <small>Collect your edge. Own the duel.</small></span>${officialLinks(true)}</footer>`}
function bindNav(){
  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  const settings=$('#settingsDialog');document.querySelector('.settings-open')?.addEventListener('click',()=>settings.showModal());settings?.querySelector('.close').addEventListener('click',()=>settings.close());
  const s=$('#sfxToggle'),m=$('#musicToggle'),p=$('#paceToggle'),r=$('#motionToggle');if(s)s.onclick=()=>toggleAudio('sfx');if(m)m.onclick=()=>toggleAudio('music');if(p)p.onclick=togglePace;if(r)r.onclick=toggleMotion;applyMotionPreference();renderAudioButtons();bindImages();bindCardTilt();
}
function bindImages(){document.querySelectorAll('img').forEach(img=>{img.addEventListener('error',()=>{if(img.src!==placeholder)img.src=placeholder},{once:true})})}
function bindCardTilt(){
  if(motionReduced())return;
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
function currentMode(){return document.querySelector('[name="mode"]:checked')?.value||selectedMode||MODES.tactical}
function currentDifficulty(){return CPU_DIFFICULTIES.expert}
function modeMeta(mode){return MODE_META[mode]||MODE_META[MODES.tactical]}
function modePickerHtml(selected=selectedMode,compact=false){
  return `<fieldset class="mode-picker mode-grid ${compact?'compact':''}"><legend>${compact?'Choose room mode':'Choose a mode'}</legend>${Object.values(MODES).map(mode=>{const meta=modeMeta(mode);return `<label class="mode-option mode-${mode}"><input type="radio" name="mode" value="${mode}" ${mode===selected?'checked':''}><span><i>${meta.icon}</i><b>${meta.name}</b><small>${meta.tagline}</small><em>${meta.description}</em></span></label>`}).join('')}</fieldset>`
}
const ATTRIBUTE_UI={
  Power:{short:'PWR',path:'M13 2 5 13h6l-1 9 9-13h-6z'},
  Agility:{short:'AGI',path:'M4 12h14m-5-5 5 5-5 5M5 7h4M5 17h4'},
  Intellect:{short:'INT',path:'M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3 3 3 0 0 0 2 3v1a3 3 0 0 0 3 3m6-14a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3 3 3 0 0 1-2 3v1a3 3 0 0 1-3 3M9 4v14m6-14v14'},
  Tech:{short:'TEC',path:'M7 7h10v10H7zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3'},
  Mystique:{short:'MYS',path:'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'},
  Charisma:{short:'CHA',path:'m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z'}
};
function attrIcon(a){const meta=ATTRIBUTE_UI[a]||ATTRIBUTE_UI.Power;return `<svg class="attr-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="${meta.path}"/></svg>`}
function attrSlug(a=''){return String(a).toLowerCase()}
function topAttribute(c){
  return ATTRIBUTES.reduce((best,a)=>c.stats[a]>c.stats[best]?a:best,ATTRIBUTES[0]);
}
function heroCards(){
  const indices=[6,29,57,83,99,128,159,196];
  const picks=indices.map(i=>cards[i]).filter(Boolean);
  return picks.map((c,i)=>`<div class="home-card-slot home-card-${i+1}">${card(c,{slot:'showcase'})}</div>`).join('');
}

function menu(){
  screen='menu';
  const meta=modeMeta(selectedMode);
  app.innerHTML=nav()+`<main class="hero arena-home">${backgroundVideo('home')}<div class="hero-copy"><div class="eyebrow">${cards.length} CHIMPIONS. SIX WAYS TO BATTLE.</div><h1 class="premium-title">The Chimpions<span>Arena</span></h1><p class="hero-tagline">Pick your rules. Read your rival. Own the arena.</p><div class="play-panel"><div class="panel-heading"><span>CHOOSE YOUR MODE</span><small>CPU is always Expert</small></div>${modePickerHtml(selectedMode)}<div class="expert-lock"><span>🤖</span><b>EXPERT CPU</b><small>Maximum decision strength in every CPU mode.</small></div><div class="actions"><button class="primary" id="quick">Play ${meta.icon} ${meta.name} vs CPU <span aria-hidden="true">↗</span></button><button class="secondary" id="onlineBtn">Private 1v1</button></div><small class="play-note">Each mode changes the actual rules — not just the presentation.</small></div></div><div class="hero-card-showcase" aria-hidden="true"><div class="home-card-wall">${heroCards()}</div><div class="hero-glow"></div><div class="showcase-caption">BATTLE-READY CHIMPIONS • FULL ATTRIBUTES</div></div></main>${footer()}`;
  prefs.difficulty=CPU_DIFFICULTIES.expert;localStorage.setItem('chimpions:difficulty',CPU_DIFFICULTIES.expert);
  document.querySelectorAll('[name="mode"]').forEach(input=>input.onchange=()=>{selectedMode=input.value;localStorage.setItem('chimpions:mode',selectedMode);const m=modeMeta(selectedMode);$('#quick').innerHTML=`Play ${m.icon} ${m.name} vs CPU <span aria-hidden="true">↗</span>`});
  $('#quick').onclick=()=>{ensureAudio();sfx('ui');start(currentMode())};$('#onlineBtn').onclick=()=>{ensureAudio();sfx('ui');cleanup();online(currentMode())};bindNav()
}
function start(mode=selectedMode){
  cleanup();screen='battle';ensureAudio();cpuDifficulty=CPU_DIFFICULTIES.expert;
  selectedMode=Object.values(MODES).includes(mode)?mode:MODES.tactical;localStorage.setItem('chimpions:mode',selectedMode);
  prefs.difficulty=CPU_DIFFICULTIES.expert;localStorage.setItem('chimpions:difficulty',CPU_DIFFICULTIES.expert);
  selectedTriple=[];selectedWager=1;
  const starter=Math.random()<.5?0:1,maxRounds=selectedMode===MODES.survivor?36:24;
  game=createMatch(cards,{maxRounds,mode:selectedMode,starter});
  prepareCpuBan();battleIntroPending=true;renderBattle();startBattleMusic({restart:true});sfx('ui');
  if(game.phase==='choose'&&game.active===1)scheduleCpu();
}
function prepareCpuBan(){
  if(!game||game.finished||game.mode!==MODES.banCounter||game.phase!=='ban'||game.active!==0)return;
  const ban=chooseCpuBan(game,game.decks[0][0],cards);setBan(game,ban,1);
}
function statMarkup(c,a,interactive,selected,disabled){
  const tag=interactive?'button':'div',reason=disabled?'Locked in Tactical mode because this attribute was used last round.':'',attrs=interactive?`data-stat="${a}" ${disabled?'disabled':''} ${reason?`title="${reason}" aria-label="${a} ${c.stats[a]}. ${reason}"`:''}`:'',meta=ATTRIBUTE_UI[a]||{icon:'•',short:a};
  return `<${tag} class="stat attr-${attrSlug(a)} ${selected===a?'selected':''} ${disabled?'locked':''}" ${attrs}>
    <span class="stat-icon">${attrIcon(a)}</span><span class="stat-name">${a}</span><b>${c.stats[a]}</b>${disabled?'<small class="stat-lock">LOCKED</small>':''}<i style="--v:${c.stats[a]}%"></i>
  </${tag}>`
}
function card(c,{hidden=false,interactive=false,selected=null,slot='player',disabledAttrs=[],outcome=null,reveal=false}={}){
  if(hidden)return `<article class="card premium-card back ${slot}"><div class="tcg-shell" aria-hidden="true"></div><div class="opponent-card-art" aria-hidden="true"><img src="/ui/opponent-card-back.svg" alt="" draggable="false"></div></article>`;
  if(!c)return '';
  const affinity=topAttribute(c),peak=c.stats[affinity],outcomeClass=outcome?` round-${outcome}`:'';
  return `<article class="card premium-card ${slot} affinity-${attrSlug(affinity)}${outcomeClass} ${reveal?'just-revealed':''}" data-card-tilt>
    <div class="tcg-shell" aria-hidden="true"></div>
    <div class="card-foil"></div><div class="card-glint"></div><div class="card-inner">
      <div class="card-meta"><span>${escapeHtml(c.tribe||'Unaligned')}</span><em>${attrIcon(affinity)} ${peak}</em></div><div class="art"><img src="${c.image}" alt="${escapeHtml(c.name)}" loading="eager"></div>
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
function tacticalStatus({lastAttribute,active,swaps},labels=['YOU','CPU']){
  if(lastAttribute===undefined)return '';
  const lock=lastAttribute?`<span><b>LOCKED</b> ${lastAttribute} · used last round</span>`:'<span><b>LOCKED</b> none yet</span>';
  const next=`<span><b>CHOOSER</b> ${labels[active]||labels[0]}</span>`;
  const reserve=`<span><b>RESERVE</b> ${swaps?.[0]??0} token${(swaps?.[0]??0)===1?'':'s'} left</span>`;
  return `<div class="tactical-status">${lock}${next}${reserve}</div>`
}
function bindSwapPreview(button,action){
  if(!button||button.disabled)return;
  let armed=false;
  button.onclick=()=>{
    if(!armed){
      armed=true;button.classList.add('confirming');button.innerHTML='Confirm swap <small>Current card moves to reserve; next card becomes active.</small>';
      return
    }
    action()
  }
}
function revealHoldMs(){return prefs.fast?REVEAL_HOLD_FAST_MS:REVEAL_HOLD_NORMAL_MS}
function queueRoundAdvance(){
  if(roundAdvanceTimer){clearTimeout(roundAdvanceTimer);timers.delete(roundAdvanceTimer)}
  roundAdvanceTimer=schedule(()=>{roundAdvanceTimer=null;afterReveal()},revealHoldMs())
}
function continueRound(){
  if(roundAdvanceTimer){clearTimeout(roundAdvanceTimer);timers.delete(roundAdvanceTimer);roundAdvanceTimer=null}
  afterReveal()
}
function bindBattleKeys({canChoose=false,reveal=false,online=false}={}){
  document.onkeydown=e=>{
    const tag=document.activeElement?.tagName;if(['INPUT','SELECT','TEXTAREA'].includes(tag)||document.querySelector('dialog[open]'))return;
    if(reveal&&!online&&(e.key==='Enter'||e.key===' ')){e.preventDefault();$('#continueRound')?.click();return}
    if(!canChoose)return;
    if(/^[1-6]$/.test(e.key)){
      const target=document.querySelector('[data-stat="'+ATTRIBUTES[Number(e.key)-1]+'"]');
      if(target&&!target.disabled){e.preventDefault();target.click()}return
    }
    if(e.key.toLowerCase()==='s'){const swap=online?$('#netSwap'):$('#swap');if(swap&&!swap.disabled){e.preventDefault();swap.click()}}
  };
  schedule(()=>{const target=reveal&&!online?$('#continueRound'):canChoose?document.querySelector('[data-stat]:not(:disabled)'):null;target?.focus({preventScroll:true})},35)
}
function idleVersus(canChoose,pot=0){
  return `<div class="versus idle-versus"><div class="arena-core"><span>VS</span></div><b>${canChoose?'CHOOSE YOUR EDGE':'OPPONENT THINKING'}</b>${pot?`<div class="pot">POT × ${pot}</div>`:''}</div>`
}
function duelVersus(result,rightLabel='CPU'){
  const state=result.winner===null?'tie':result.winner===0?'you-win':'rival-win',winner=result.winner===null?null:result.cards[result.winner],verdict=result.winner===null?'STANDOFF':result.winner===0?'YOU WIN THE DUEL':`${rightLabel} WINS THE DUEL`;
  return `<div class="versus reveal-versus ${state}">
    <div class="duel-energy" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="duel-attribute"><i>${attrIcon(result.attribute)}</i><span>${result.attribute} DUEL</span></div>
    <div class="duel-scoreline">
      <div class="score-plate score-player"><small>YOU</small><b class="score-value" data-target="${result.values[0]}">${result.values[0]}</b></div>
      <i class="duel-vs">VS</i>
      <div class="score-plate score-rival"><small>${rightLabel}</small><b class="score-value" data-target="${result.values[1]}">${result.values[1]}</b></div>
    </div>
    <div class="duel-verdict">${verdict}</div>
    <div class="duel-winner-name">${winner?escapeHtml(winner.name):'THE POT GROWS'}</div>
    <div class="winner-stamp ${result.winner===null?'stamp-tie':result.winner===0?'stamp-player':'stamp-rival'}">${result.winner===null?'STANDOFF':'WINNER'}</div>
  </div>`
}
function battleIntroFx(rightLabel='CPU'){
  return `<div class="battle-intro-fx" aria-hidden="true"><div class="intro-scanline"></div><div class="intro-mark"><small>THE CHIMPIONS ARENA</small><b>DUEL INITIALIZED</b><span>YOU <i>VS</i> ${rightLabel}</span></div></div>`
}
function animateCaptureCounts(result,counts){
  if(!result?.countsBefore)return;
  const nodes=[...document.querySelectorAll('.hud-count b')];
  nodes.forEach((node,i)=>node.textContent=result.countsBefore[i]);
  const arena=document.querySelector('.arena');
  schedule(()=>{if(!arena?.isConnected)return;nodes.forEach((node,i)=>{node.textContent=counts[i];node.parentElement.classList.add('count-updated')})},motionReduced()?0:Math.min(1750,revealHoldMs()-150))
}
function animateDuelScores(){
  const els=[...document.querySelectorAll('.score-value')];if(!els.length)return;
  const start=performance.now(),duration=motionReduced()?0:450;
  const tick=now=>{const p=duration?Math.min(1,(now-start)/duration):1,ease=1-Math.pow(1-p,3);els.forEach(el=>el.textContent=Math.round(Number(el.dataset.target||0)*ease));if(p<1)requestAnimationFrame(tick)};
  requestAnimationFrame(tick)
}
function captureFx(result){
  if(!result)return '';
  if(result.winner===null)return '<div class="capture-fx standoff-fx"><i></i><i></i><i></i></div>';
  const dir=result.winner===0?'to-player':'to-rival';
  return `<div class="capture-cards ${dir}" aria-hidden="true">${(result.capturedCards?.length?result.capturedCards:result.cards).map((c,i)=>`<div class="flying-card" style="--i:${i}"><img src="${c.image}" alt=""></div>`).join('')}<span>+${result.capturedCount||2} cards</span></div>`
}
function renderBattle(){
  if(!game)return menu();if(game.finished)return finish();
  const reveal=game.phase==='reveal',result=game.result;
  const p=reveal?result.cards[0]:game.decks[0][0],o=reveal?result.cards[1]:game.decks[1][0];
  const canChoose=!reveal&&game.active===0,legal=legalAttributes(game),disabled=ATTRIBUTES.filter(a=>!legal.includes(a));
  const status=outcomeText(result),roundClass=reveal?(result.winner===null?'is-tie':result.winner===0?'is-win':'is-loss'):'',phaseClass=reveal?'reveal-phase':'choose-phase';
  const pOutcome=reveal?(result.winner===null?'tie':result.winner===0?'winner':'loser'):null,oOutcome=reveal?(result.winner===null?'tie':result.winner===1?'winner':'loser'):null;
  const banner=reveal?`${result.attribute.toUpperCase()} LOCKED • ROUND RESOLVED`:canChoose?'YOUR TURN • CHOOSE AN ATTRIBUTE':'CPU IS SCANNING THE MATCHUP';
  const intro=battleIntroPending&&!reveal;
  app.innerHTML=nav()+`<main class="arena ${roundClass} ${phaseClass} ${intro?'battle-intro':''}">
    ${backgroundVideo('battle')}
    ${intro?battleIntroFx('CPU'):''}
    <div class="arena-atmosphere"><i></i><i></i><i></i></div>
    ${battleHud(game.decks[0].length,game.decks[1].length,'CPU',game.round,game.maxRounds,game.mode+' · '+cpuDifficulty+' CPU',game.pot.length*2)}
    <div class="turn-banner ${canChoose?'your-turn':''} ${reveal?'result-banner':''}">${banner}</div>
    ${game.mode===MODES.tactical&&!reveal?tacticalStatus(game,['YOU','CPU']):''}
    <section class="table">
      <div class="player-slot">${card(p,{interactive:canChoose,selected:result?.attribute,slot:'player',disabledAttrs:disabled,outcome:pOutcome})}${game.mode===MODES.tactical&&!reveal?`<button class="swap" id="swap" ${!canChoose||!game.swaps[0]||game.decks[0].length<2?'disabled':''}>Reserve swap <b>${game.swaps[0]}</b></button>`:''}</div>
      ${reveal?duelVersus(result,'CPU'):idleVersus(canChoose,game.pot.length*2)}
      <div class="opponent-slot">${card(o,{hidden:!reveal,interactive:false,selected:result?.attribute,slot:'opponent',outcome:oOutcome,reveal})}</div>
    </section>
    ${reveal?captureFx(result):''}
    ${reveal?'<div class="round-actions"><button class="primary continue-round" id="continueRound">Next round</button><small>Auto-continues in '+(revealHoldMs()/1000).toFixed(1)+'s · '+(prefs.fast?'Fast':'Normal')+' pace</small></div>':''}
    <div id="announcer" class="sr-only" aria-live="polite">${status}</div>
  </main>`;
  bindNav();if(intro)battleIntroPending=false;if(reveal){animateDuelScores();animateCaptureCounts(result,game.decks.map(d=>d.length))};
  if(canChoose)document.querySelectorAll('[data-stat]').forEach(b=>b.onclick=()=>choose(b.dataset.stat));
  const sw=$('#swap');if(sw)bindSwapPreview(sw,doSwap);
  const next=$('#continueRound');if(next)next.onclick=continueRound;bindBattleKeys({canChoose,reveal,online:false});
  preload(game.decks[0][1]?.image);preload(game.decks[1][1]?.image)
}
function choose(attribute){
  if(!game||game.finished||game.phase!=='choose'||game.active!==0)return;
  ensureAudio();sfx('select');
  try{const r=resolveRound(game,attribute,0);sfx('reveal');schedule(()=>roundSound(r),650);renderBattle();queueRoundAdvance()}catch(e){console.warn(e)}
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
    let chosen=chooseCpuAttribute(game.decks[1][0],cards,banned,{difficulty:cpuDifficulty,rng:Math.random});
    const strength=attributeWinRate(game.decks[1][0],chosen,cards);
    if(game.mode===MODES.tactical&&game.swaps[1]&&game.decks[1].length>1&&strength<.42){
      reserveSwap(game,1);sfx('swap');renderBattle();chosen=chooseCpuAttribute(game.decks[1][0],cards,banned,{difficulty:cpuDifficulty,rng:Math.random})
    }
    const r=resolveRound(game,chosen,1);sfx('reveal');schedule(()=>roundSound(r),650);renderBattle();queueRoundAdvance()
  },CPU_THINK_MS)
}
function finish(){
  stopBattleMusic(true);
  if(!game)return menu();const out=game.outcome||finishMatch(game),state=out.winner===0?'win':out.winner===1?'loss':'draw',margin=Math.abs(out.counts[0]-out.counts[1]);
  const title=state==='win'?'Arena conquered':state==='loss'?'Defeat':'Dead even';
  const copy=state==='win'?'Your reads converted into captures.':state==='loss'?'The CPU controlled the final card advantage.':'Neither side could break the final balance.';
  if(state==='win')sfx('final');else sfx(state==='loss'?'lose':'tie');
  const particles=state==='win'?`<div class="particles" aria-hidden="true">${Array.from({length:26},(_,i)=>`<i style="--i:${i}"></i>`).join('')}</div>`:'';
  app.innerHTML=nav()+`<main class="result match-result result-video-screen ${state}">${backgroundVideo('battle')}${particles}<div class="result-aura"></div>
    <div class="result-kicker">MATCH COMPLETE • ${game.mode.toUpperCase()}</div>
    <div class="trophy">${crest()}</div><h1>${title}</h1><p>${copy}</p>
    <div class="final-scoreboard"><div><small>YOU</small><b>${out.counts[0]}</b></div><i>FINAL</i><div><small>CPU</small><b>${out.counts[1]}</b></div></div>
    <div class="result-metrics"><span><b>${out.roundsPlayed}</b> rounds</span><span><b>${margin}</b> card margin</span><span><b>${out.history.filter(h=>h.winner===null).length}</b> standoffs</span></div>
    <div class="result-actions"><button class="primary" id="again">Rematch</button><button data-go="menu">Main menu</button></div>
  </main>`;
  $('#again').onclick=()=>start();bindNav();syncArenaVideo()
}

function gallery(){
  screen='gallery';const tribes=[...new Set(cards.map(c=>c.tribe||'Unaligned'))].sort();
  app.innerHTML=nav()+`<main class="collection"><div class="collection-title"><div><small>COLLECTION & GAME STATS • ${cards.length} PLAYABLE</small><h1>Meet the Chimpions</h1><p class="collection-source">Find your signature Chimpion. Explore six balanced attributes and every tribe.</p></div><div class="filters"><input id="search" placeholder="Search name or tribe" aria-label="Search collection"><select id="tribe" aria-label="Filter by tribe"><option value="">All tribes</option>${tribes.map(t=>`<option>${escapeHtml(t)}</option>`).join('')}</select><select id="sort" aria-label="Sort collection"><option value="id">Number</option><option value="name">Name</option>${ATTRIBUTES.map(a=>`<option value="${a}">${a}</option>`).join('')}</select></div></div><div class="collection-count" id="collectionCount" aria-live="polite"></div><div class="grid" id="grid"></div><dialog id="detail"><button class="close" aria-label="Close">×</button><div id="detailBody"></div></dialog></main>${footer()}`;
  const draw=()=>{
    const q=$('#search').value.toLowerCase(),tribe=$('#tribe').value,sort=$('#sort').value;
    let list=cards.filter(c=>(c.name+' '+(c.tribe||'')).toLowerCase().includes(q)&&(!tribe||c.tribe===tribe));
    list=[...list].sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):ATTRIBUTES.includes(sort)?b.stats[sort]-a.stats[sort]:Number(a.id)-Number(b.id));
    $('#collectionCount').textContent=`${list.length} Chimpions`;
    $('#grid').innerHTML=list.length?list.map(c=>{const edge=topAttribute(c);return `<button class="tile affinity-${attrSlug(edge)}" data-id="${c.id}">
      <div class="tile-art"><span class="tile-foil"></span><img loading="lazy" src="${c.image}" alt="${escapeHtml(c.name)}"><em>${attrIcon(edge)} ${edge} ${c.stats[edge]}</em></div>
      <div class="tile-head"><small>#${String(c.id).padStart(3,'0')}</small><b>${escapeHtml(c.name)}</b></div><span>${escapeHtml(c.tribe||'Unaligned')}</span>
    </button>`}).join(''):`<div class="empty-search">No Chimpions match these filters.</div>`;
    bindImages();document.querySelectorAll('.tile').forEach(t=>t.onclick=()=>showDetail(t.dataset.id))
  };
  $('#search').oninput=draw;$('#tribe').onchange=draw;$('#sort').onchange=draw;$('#detail .close').onclick=()=>$('#detail').close();draw();bindNav()
}
function showDetail(id){
  const visible=[...document.querySelectorAll('.tile')].map(t=>t.dataset.id),index=visible.indexOf(String(id)),c=cards.find(x=>String(x.id)===String(id));if(!c)return;
  const edge=topAttribute(c);
  $('#detailBody').innerHTML=`<div class="detail-showcase affinity-${attrSlug(edge)}"><div class="detail-art"><img src="${c.image}" alt="${escapeHtml(c.name)}"></div><span>${escapeHtml(c.tribe||'Unaligned')}</span></div><div class="detail-info"><small class="eyebrow">CHIMPION #${String(c.id).padStart(3,'0')}</small><h2>${escapeHtml(c.name)}</h2><p>Strongest edge <b>${edge} · ${c.stats[edge]}</b></p><div class="detail-stats">${ATTRIBUTES.map(a=>`<div class="attr-${attrSlug(a)}"><span>${attrIcon(a)} ${a}</span><b>${c.stats[a]}</b><i style="--v:${c.stats[a]}%"></i></div>`).join('')}</div><div class="detail-navigation"><button id="previousCard" ${index<=0?'disabled':''}>← Previous</button><span>${index+1} / ${visible.length}</span><button id="nextCard" ${index>=visible.length-1?'disabled':''}>Next →</button></div></div>`;
  $('#previousCard').onclick=()=>showDetail(visible[index-1]);$('#nextCard').onclick=()=>showDetail(visible[index+1]);bindImages();if(!$('#detail').open)$('#detail').showModal()
}

function help(){app.innerHTML=nav()+`<main class="copy"><small>CHIMPIONS ARENA • SIX MODES</small><h1>How to play</h1><ol><li><b>🧠 Tactical:</b> alternating chooser, one Reserve Swap each, and the last-used attribute locks for the following round.</li><li><b>💎 Wager:</b> choose a 1–3 card stake, then choose an attribute. Only the lead cards compare; the winner captures every staked card plus any standoff pot.</li><li><b>🚫 Ban & Counter:</b> before each duel, the defender bans one attribute. The chooser must attack through one of the five remaining stats.</li><li><b>⚔️ Triple Clash:</b> select three different attributes. Each attribute is a mini-duel; win more of the three to take the round.</li><li><b>☠️ Survivor:</b> defeated Chimpions are eliminated instead of captured. The winning Chimpion stays at the front until it is beaten. Last squad standing wins.</li><li><b>🌀 Chaos:</b> a new arena modifier appears every round, including Reverse Gravity, attribute lockouts, Crosswire, Sudden Tie, Underdog Boost and Bonus Capture.</li><li><b>CPU is always Expert.</b> Private rooms use the selected mode and stalled turns still auto-resolve.</li></ol><p>All six modes use the same 221-card collection and six deterministic gameplay attributes. They do not represent rarity or market value.</p>${officialLinks(false)}<button class="primary" id="go">Enter Chimpions Arena</button></main>`;$('#go').onclick=()=>go('menu');bindNav()}
function online(){
  cleanup();screen='online';
  app.innerHTML=nav()+`<main class="copy online-copy"><small>YOUR FRIEND. YOUR RIVAL.</small><h1>Challenge a friend</h1><p>Create a four-letter room code or enter one shared by a friend. All rooms use Tactical rules. A disconnected player ends the room; stalled turns auto-resolve after the visible timer.</p><div class="online-rules-lock"><b>Tactical 1v1</b><span>Alternating turns • reserve swap • last-used attribute lock</span></div><div class="room"><button class="primary" id="create">Create room</button><input id="code" maxlength="4" autocomplete="off" placeholder="CODE" aria-label="Room code"><button id="join">Join</button></div><div id="status" aria-live="polite">Connecting…</div></main>`;bindNav();
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/room`);
  socket.onopen=()=>setStatus('Connected — create or join a room.');
  socket.onerror=()=>setStatus('Connection problem. Check the server and try again.');
  socket.onclose=()=>{if(screen==='online'){stopBattleMusic(true);if($('#status'))setStatus('Connection closed. Return to the menu to reconnect.')}};
  socket.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}handleNet(m)};
  $('#create').onclick=()=>sendWs({type:'create',mode:MODES.tactical});$('#join').onclick=()=>sendWs({type:'join',code:$('#code').value.trim().toUpperCase()});
}
function setStatus(t){const el=$('#status');if(el)el.textContent=t}
function sendWs(payload){if(!socket||socket.readyState!==WebSocket.OPEN)return setStatus('Still connecting — try again in a moment.');socket.send(JSON.stringify(payload))}
function handleNet(m){
  if(m.type==='room')return setStatus(`Room ${m.code} — waiting for your friend…`);
  if(m.type==='ready')return setStatus(`Room ${m.code} ready. ${m.mode.toUpperCase()} rules.`);
  if(m.type==='state'){if(!netState&&m.round===1)battleIntroPending=true;netState=m;return netBattle(m)}
  if(m.type==='reveal')return netReveal(m);
  if(m.type==='gameover')return netGameOver(m);
  if(m.type==='left'){stopBattleMusic(true);netState=null;return setStatus('Opponent disconnected. This room is closed; create a new room for a rematch.')}
  if(m.type==='error')return setStatus(m.message)
}
function deadlineMarkup(deadline){return deadline?`<span class="deadline">TURN <b id="turnTimer">--</b>s</span>`:''}
function startDeadline(deadline){if(!deadline)return;const draw=()=>{const el=$('#turnTimer');if(el)el.textContent=Math.max(0,Math.ceil((deadline-Date.now())/1000))};draw();every(draw,250)}
function netBattle(m){
  screen='online';startBattleMusic();for(const id of intervals)clearInterval(id);intervals.clear();const legal=m.legal||ATTRIBUTES,disabled=ATTRIBUTES.filter(a=>!legal.includes(a));
  const intro=battleIntroPending&&m.round===1;
  app.innerHTML=nav()+`<main class="arena choose-phase ${intro?'battle-intro':''}">${backgroundVideo('battle')}${intro?battleIntroFx('RIVAL'):''}<div class="arena-atmosphere"><i></i><i></i><i></i></div>
    ${battleHud(m.counts[0],m.counts[1],'RIVAL',m.round,m.maxRounds,m.mode,m.pot)}
    <div class="turn-banner ${m.turn?'your-turn':''}">${m.turn?'YOUR TURN • CHOOSE AN ATTRIBUTE':'RIVAL IS CHOOSING'} ${deadlineMarkup(m.deadline)}</div>
    ${m.mode===MODES.tactical?tacticalStatus({lastAttribute:m.lastAttribute,active:m.turn?0:1,swaps:m.swaps},['YOU','RIVAL']):''}
    <section class="table"><div class="player-slot">${card(m.card,{interactive:m.turn,slot:'player',disabledAttrs:disabled})}${m.mode===MODES.tactical?`<button class="swap" id="netSwap" ${!m.turn||!m.swaps?.[0]?'disabled':''}>Reserve swap <b>${m.swaps?.[0]||0}</b></button>`:''}</div>
    ${idleVersus(m.turn,m.pot)}
    <div class="opponent-slot">${card(null,{hidden:true,slot:'opponent'})}</div></section><div id="announcer" class="sr-only" aria-live="polite">${m.turn?'Your move':'Opponent turn'}</div></main>`;bindNav();if(intro)battleIntroPending=false;
  if(m.turn)document.querySelectorAll('[data-stat]').forEach(b=>b.onclick=()=>{sfx('select');sendWs({type:'action',action:b.dataset.stat})});
  const sw=$('#netSwap');if(sw)bindSwapPreview(sw,()=>sendWs({type:'swap'}));bindBattleKeys({canChoose:m.turn,reveal:false,online:true});startDeadline(m.deadline)
}
function netReveal(m){
  for(const id of intervals)clearInterval(id);intervals.clear();const winner=m.winner===null?null:m.winner==='you'?0:1,cls=winner===null?'is-tie':winner===0?'is-win':'is-loss',status=winner===null?'STANDOFF':winner===0?'YOU WIN':'RIVAL WINS',result={cards:m.cards,capturedCards:m.capturedCards,values:m.values,attribute:m.attribute,winner,countsBefore:m.countsBefore,capturedCount:m.capturedCount};
  sfx('reveal');schedule(()=>sfx(winner===null?'tie':winner===0?'win':'lose'),650);
  const counts=m.counts||netState?.counts||['—','—'],round=m.round||netState?.round||'—',maxRounds=m.maxRounds||netState?.maxRounds||24,mode=m.mode||netState?.mode||MODES.tactical;
  app.innerHTML=nav()+`<main class="arena ${cls} reveal-phase">${backgroundVideo('battle')}<div class="arena-atmosphere"><i></i><i></i><i></i></div>
    ${battleHud(counts[0],counts[1],'RIVAL',round,maxRounds,mode,m.pot||0)}
    <div class="turn-banner result-banner">${m.attribute.toUpperCase()} LOCKED • ROUND RESOLVED</div>
    <section class="table"><div class="player-slot">${card(m.cards[0],{selected:m.attribute,slot:'player',outcome:winner===null?'tie':winner===0?'winner':'loser'})}</div>
    ${duelVersus(result,'RIVAL')}
    <div class="opponent-slot">${card(m.cards[1],{selected:m.attribute,slot:'opponent',outcome:winner===null?'tie':winner===1?'winner':'loser',reveal:true})}</div></section>
    ${captureFx(result)}
    <div id="announcer" class="sr-only" aria-live="polite">${status}</div></main>`;bindNav();animateDuelScores();animateCaptureCounts(result,counts);bindBattleKeys({canChoose:false,reveal:true,online:true})
}
function netGameOver(m){
  stopBattleMusic(true);
  const state=m.winner==='you'?'win':m.winner==='draw'?'draw':'loss',title=state==='win'?'Victory':state==='draw'?'Draw':'Defeat',margin=Math.abs(m.counts[0]-m.counts[1]);
  if(state==='win')sfx('final');else sfx(state==='draw'?'tie':'lose');
  app.innerHTML=nav()+`<main class="result match-result ${state}"><div class="result-aura"></div><div class="result-kicker">PRIVATE 1V1 • MATCH COMPLETE</div>
    <div class="trophy">${crest()}</div><h1>${title}</h1><p>The room resolved with a final card margin of ${margin}.</p>
    <div class="final-scoreboard"><div><small>YOU</small><b>${m.counts[0]}</b></div><i>FINAL</i><div><small>RIVAL</small><b>${m.counts[1]}</b></div></div>
    <div class="result-actions"><button class="primary" id="onlineAgain">New room</button><button data-go="menu">Main menu</button></div></main>`;$('#onlineAgain').onclick=()=>online(m.mode||MODES.tactical);bindNav()
}

fetch('/data/chimpions.json').then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}).then(d=>{manifest=d;cards=decorateCards(d.cards||[]);menu()}).catch(()=>app.innerHTML='<main class="result loss"><h1>Collection unavailable</h1><p>Refresh to try again.</p></main>');
