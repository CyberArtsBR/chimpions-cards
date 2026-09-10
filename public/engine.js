export const ATTRIBUTES=['Power','Agility','Intellect','Tech','Mystique','Charisma'];
export const MODES={
  tactical:'tactical',
  banCounter:'ban-counter',
  triple:'triple',
  teamTag:'team-tag'
};
export const MODE_META={
  [MODES.tactical]:{icon:'🧠',name:'Tactical',tagline:'Competitive control',description:'Alternating turns, one reserve swap, and the last-used attribute locks for one round.',deckSize:6},
  [MODES.banCounter]:{icon:'🚫',name:'Ban & Counter',tagline:'Read the rival',description:'The defender bans one attribute before the chooser locks the duel.',deckSize:6},
  [MODES.triple]:{icon:'⚔️',name:'Triple Clash',tagline:'Best of three stats',description:'Choose three attributes. Win at least two comparisons to capture the round.',deckSize:6},
  [MODES.teamTag]:{icon:'🤝',name:'Team Tag 2v2',tagline:'Two cards fight together',description:'20 cards each. Two Chimpions per side enter each round. Own both top-two values to capture the rival pair and keep initiative.',deckSize:20}
};
export const CPU_DIFFICULTIES={easy:'easy',standard:'standard',expert:'expert'};

export function hashString(s=''){
  let h=2166136261;
  for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}
  return h>>>0;
}
function rebalance(values,target=360,min=34,max=86){
  const out=values.map(v=>Math.max(min,Math.min(max,Math.round(v))));
  let delta=target-out.reduce((a,b)=>a+b,0),guard=0;
  while(delta!==0&&guard++<1000){
    const step=delta>0?1:-1;
    const order=[...out.keys()].sort((a,b)=>step>0?out[a]-out[b]:out[b]-out[a]);
    let changed=false;
    for(const i of order){
      const next=out[i]+step;
      if(next>=min&&next<=max){out[i]=next;delta-=step;changed=true;if(delta===0)break}
    }
    if(!changed)break
  }
  return out
}
export function cardStats(card){
  const seed=card?.mint||`${card?.id||''}:${card?.name||''}`;
  let x=hashString(seed);
  const raw=ATTRIBUTES.map(()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return 38+(x%45)});
  const maxI=raw.indexOf(Math.max(...raw)),minI=raw.indexOf(Math.min(...raw));
  raw[maxI]+=8;raw[minI]-=8;
  const vals=rebalance(raw);
  return Object.fromEntries(ATTRIBUTES.map((a,i)=>[a,vals[i]]))
}
export function validateCardStats(stats){
  if(!stats||typeof stats!=='object'||Array.isArray(stats))throw new Error('Card stats must be an object');
  const keys=Object.keys(stats);
  if(keys.length!==ATTRIBUTES.length||ATTRIBUTES.some(a=>!Object.hasOwn(stats,a)))throw new Error('Card stats must contain exactly six attributes');
  for(const a of ATTRIBUTES){const v=stats[a];if(!Number.isFinite(v)||!Number.isInteger(v)||v<0||v>100)throw new Error('Invalid '+a+' stat')}
  return true
}
export function decorateCard(card){
  if(!card||typeof card!=='object')throw new Error('Invalid card');
  const stats=card.stats??cardStats(card);validateCardStats(stats);return {...card,stats:{...stats}}
}
export function decorateCards(cards=[]){
  if(!Array.isArray(cards))throw new Error('Cards must be an array');
  return cards.map(decorateCard)
}
function validateMatchCards(cards){
  const seen=new Set();
  for(const [i,c] of cards.entries()){
    const identity=c?.mint?'mint:'+c.mint:'id:'+c?.id;
    if(identity.endsWith(':undefined')||identity.endsWith(':null')||identity.endsWith(':'))throw new Error('Card '+i+' has no competitive identity');
    if(seen.has(identity))throw new Error('Duplicate competitive identity: '+identity);
    seen.add(identity)
  }
}
export function shuffled(input=[],rng=Math.random){
  const a=[...input];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]}
  return a
}
function isMode(mode){return Object.values(MODES).includes(mode)}
export function legalAttributes(game){
  if(!game||game.finished)return [];
  return ATTRIBUTES.filter(a=>{
    if(game.mode===MODES.tactical&&game.lastAttribute===a)return false;
    if(game.mode===MODES.banCounter&&game.bannedAttribute===a)return false;
    return true
  })
}
export function createMatch(cards,{deckSize=null,maxRounds=24,mode=MODES.tactical,starter=0,rng=Math.random}={}){
  if(deckSize!==null&&(!Number.isInteger(deckSize)||deckSize<1))throw new Error('deckSize must be a positive integer');
  if(!Number.isInteger(maxRounds)||maxRounds<1)throw new Error('maxRounds must be a positive integer');
  if(starter!==0&&starter!==1)throw new Error('starter must be 0 or 1');
  if(!isMode(mode))throw new Error('Invalid mode');
  if(typeof rng!=='function')throw new Error('rng must be a function');
  const decorated=decorateCards(cards);validateMatchCards(decorated);const pool=shuffled(decorated,rng);
  const requested=mode===MODES.teamTag?20:(deckSize??MODE_META[mode].deckSize);
  if(mode===MODES.teamTag&&pool.length<40)throw new Error('Team Tag requires at least 40 unique cards');
  const n=Math.min(requested,Math.floor(pool.length/2));
  if(n<1)throw new Error('Not enough cards to start a match');
  return {
    decks:[pool.slice(0,n),pool.slice(n,n*2)],pot:[],round:1,maxRounds,active:starter,mode,
    phase:mode===MODES.banCounter?'ban':'choose',lastAttribute:null,bannedAttribute:null,
    result:null,history:[],finished:false,outcome:null,swaps:[mode===MODES.tactical?1:0,mode===MODES.tactical?1:0]
  }
}
export function reserveSwap(game,seat){
  if(!game||game.finished||game.phase!=='choose')throw new Error('Swap unavailable now');
  if(game.mode!==MODES.tactical)throw new Error('Reserve swap is tactical-only');
  if(seat!==game.active)throw new Error('Not your turn');
  if(!game.swaps[seat])throw new Error('No reserve swap remaining');
  if(game.decks[seat].length<2)throw new Error('Not enough cards to swap');
  game.decks[seat].push(game.decks[seat].shift());game.swaps[seat]-=1;return game
}
export function setBan(game,attribute,seat){
  if(!game||game.finished)throw new Error('Match finished');
  if(game.mode!==MODES.banCounter||game.phase!=='ban')throw new Error('Ban unavailable now');
  if(seat===game.active)throw new Error('Chooser cannot ban');
  if(seat!==1-game.active)throw new Error('Not the defender');
  if(!ATTRIBUTES.includes(attribute))throw new Error('Invalid attribute');
  game.bannedAttribute=attribute;game.phase='choose';return game
}
function validateChoice(game,choice){
  const legal=legalAttributes(game);
  if(game.mode===MODES.triple){
    if(!Array.isArray(choice)||choice.length!==3||new Set(choice).size!==3||choice.some(a=>!legal.includes(a)))throw new Error('Triple Clash requires three legal attributes');
    return [...choice]
  }
  if(typeof choice!=='string'||!legal.includes(choice))throw new Error('Illegal attribute');
  return [choice]
}
function compareCards(left,right,attribute){
  const values=[left.stats[attribute],right.stats[attribute]];
  return {attribute,values,winner:values[0]===values[1]?null:(values[0]>values[1]?0:1)}
}
function resolveTeamTag(game,attribute,chooser){
  if(game.decks[0].length<2||game.decks[1].length<2)return finishMatch(game);
  const countsBefore=game.decks.map(d=>d.length);
  const teams=[game.decks[0].splice(0,2),game.decks[1].splice(0,2)];
  const entries=[];
  teams.forEach((pair,seat)=>pair.forEach((card,slot)=>entries.push({seat,slot,card,value:card.stats[attribute]})));
  const ranked=[...entries].sort((a,b)=>b.value-a.value||a.seat-b.seat||a.slot-b.slot);
  const cutoff=ranked[1].value;
  const atOrAbove=ranked.filter(x=>x.value>=cutoff);
  const ambiguousCutoff=atOrAbove.length>2;
  const topTwo=ranked.slice(0,2);
  let winner=null;
  if(!ambiguousCutoff&&topTwo[0].seat===topTwo[1].seat)winner=topTwo[0].seat;
  let capturedCards=[];
  if(winner===null){
    game.decks[0].push(...teams[0]);game.decks[1].push(...teams[1]);
    game.active=1-chooser
  }else{
    const loser=1-winner;
    capturedCards=[...teams[loser]];
    game.decks[winner].push(...teams[winner],...teams[loser]);
    game.active=winner
  }
  const teamValues=teams.map(pair=>pair.map(c=>c.stats[attribute]));
  const result={
    cards:[teams[0][0],teams[1][0]],teamCards:teams,teamValues,rankings:ranked.map(x=>({seat:x.seat,slot:x.slot,value:x.value,card:x.card})),
    capturedCards,capturedCount:captureCount(winner),values:[Math.max(...teamValues[0]),Math.max(...teamValues[1])],
    winner,attribute,attributes:[attribute],comparisons:[],chooser,countsBefore,stake:1,bannedAttribute:null
  };
  game.phase='reveal';game.result=result;
  game.history.push({round:game.round,mode:game.mode,attribute,values:[...result.values],teamValues:teamValues.map(x=>[...x]),winner,chooser,potPairs:0});
  return result
}
function captureCount(winner){return winner===null?0:2}
export function resolveRound(game,choice,seat){
  if(!game||game.finished)throw new Error('Match finished');
  if(game.phase!=='choose')throw new Error('Round is not ready for a duel');
  if(seat!==game.active)throw new Error('Not your turn');
  const attributes=validateChoice(game,choice),chooser=game.active;
  if(game.mode===MODES.teamTag)return resolveTeamTag(game,attributes[0],chooser);
  if(!game.decks[0][0]||!game.decks[1][0])return finishMatch(game);
  const countsBefore=game.decks.map(d=>d.length),drawn=[game.decks[0].shift(),game.decks[1].shift()];
  let values,winner=null,comparisons=[];
  if(game.mode===MODES.triple){
    comparisons=attributes.map(a=>compareCards(drawn[0],drawn[1],a));
    const wins=[comparisons.filter(x=>x.winner===0).length,comparisons.filter(x=>x.winner===1).length];
    values=wins;if(wins[0]!==wins[1])winner=wins[0]>wins[1]?0:1
  }else{
    const compared=compareCards(drawn[0],drawn[1],attributes[0]);comparisons=[compared];values=compared.values;winner=compared.winner
  }
  let capturedCards=[],capturedCount=0;
  if(winner===null)game.pot.push(drawn);
  else{
    const loot=[...drawn,...game.pot.flat()];game.pot=[];capturedCards=loot;capturedCount=loot.length;game.decks[winner].push(...loot)
  }
  game.active=1-chooser;
  game.lastAttribute=game.mode===MODES.tactical?attributes[0]:null;
  game.phase='reveal';
  const attribute=game.mode===MODES.triple?'Triple Clash':attributes[0];
  game.result={cards:drawn,capturedCards,values,winner,attribute,attributes,comparisons,chooser,countsBefore,capturedCount,stake:1,bannedAttribute:game.bannedAttribute};
  game.history.push({round:game.round,mode:game.mode,attribute,attributes:[...attributes],values:[...values],winner,chooser,potPairs:game.pot.length,bannedAttribute:game.bannedAttribute});
  return game.result
}
export function advanceMatch(game){
  if(!game||game.finished)return game;
  if(game.phase!=='reveal')return game;
  game.result=null;game.round+=1;
  const exhausted=game.mode===MODES.teamTag?(game.decks[0].length<2||game.decks[1].length<2):(!game.decks[0].length||!game.decks[1].length);
  if(exhausted||game.round>game.maxRounds)return finishMatch(game);
  game.bannedAttribute=null;game.phase=game.mode===MODES.banCounter?'ban':'choose';return game
}
export function returnUnresolvedPot(game){
  if(!game?.pot?.length)return;
  for(const pair of game.pot){if(pair[0])game.decks[0].push(pair[0]);if(pair[1])game.decks[1].push(pair[1])}
  game.pot=[]
}
export function finishMatch(game){
  if(game.finished)return game.outcome;
  returnUnresolvedPot(game);
  const counts=game.decks.map(d=>d.length),winner=counts[0]===counts[1]?null:(counts[0]>counts[1]?0:1);
  game.finished=true;game.phase='finished';game.outcome={winner,counts,roundsPlayed:game.history.length,history:[...game.history],mode:game.mode};return game.outcome
}
export function attributeWinRate(card,attribute,population=[]){
  const value=card.stats[attribute];let wins=0,ties=0,total=0;
  for(const rival of population){if(rival===card)continue;total++;if(value>rival.stats[attribute])wins++;else if(value===rival.stats[attribute])ties++}
  return total?(wins+ties*.5)/total:.5
}
function scoredAttributes(card,population,banned,{rng=Math.random,difficulty=CPU_DIFFICULTIES.expert,game=null}={}){
  if(!Object.values(CPU_DIFFICULTIES).includes(difficulty))throw new Error('Invalid CPU difficulty');
  if(typeof rng!=='function')throw new Error('rng must be a function');
  const legal=(game?legalAttributes(game):ATTRIBUTES).filter(a=>a!==banned);
  return legal.map(attribute=>({attribute,score:attributeWinRate(card,attribute,population),value:card.stats[attribute]}))
}
export function chooseCpuAttribute(card,population=[],banned=null,{difficulty=CPU_DIFFICULTIES.expert,rng=Math.random,game=null}={}){
  const scored=scoredAttributes(card,population,banned,{difficulty,rng,game});if(!scored.length)throw new Error('No legal attribute');
  if(difficulty===CPU_DIFFICULTIES.easy){
    const weights=scored.map(x=>.7+x.score*.6),total=weights.reduce((a,b)=>a+b,0);let roll=Math.max(0,Math.min(.999999999,Number(rng())))*total;
    for(let i=0;i<scored.length;i++){roll-=weights[i];if(roll<=0)return scored[i].attribute}return scored.at(-1).attribute
  }
  if(difficulty===CPU_DIFFICULTIES.standard){
    return scored.reduce((best,x)=>{const noisy=x.score+(Math.max(0,Math.min(1,Number(rng())))-.5)*.22;return !best||noisy>best.noisy||(noisy===best.noisy&&x.value>best.value)?{...x,noisy}:best},null).attribute
  }
  return scored.reduce((best,x)=>!best||x.score>best.score||(x.score===best.score&&x.value>best.value)?x:best,null).attribute
}
export function chooseCpuAttributes(game,card,population=[],count=3){
  const scored=scoredAttributes(card,population,null,{game,difficulty:CPU_DIFFICULTIES.expert,rng:Math.random});
  return scored.sort((a,b)=>b.score-a.score||b.value-a.value).slice(0,count).map(x=>x.attribute)
}
export function chooseCpuBan(game,opponentCard,population=[]){
  const candidates=ATTRIBUTES.map(attribute=>({attribute,score:attributeWinRate(opponentCard,attribute,population),value:opponentCard.stats[attribute]}));
  return candidates.sort((a,b)=>b.score-a.score||b.value-a.value)[0].attribute
}
export function chooseCpuTeamAttribute(game,seat,population=[]){
  const pair=game?.decks?.[seat]?.slice(0,2);if(!pair||pair.length<2)throw new Error('Team Tag requires two active cards');
  return legalAttributes(game).map(attribute=>{
    const rates=pair.map(c=>attributeWinRate(c,attribute,population));
    const values=pair.map(c=>c.stats[attribute]);
    return {attribute,score:Math.min(...rates)*.7+((rates[0]+rates[1])/2)*.3,value:values[0]+values[1]}
  }).sort((a,b)=>b.score-a.score||b.value-a.value)[0].attribute
}
export function validateCollection(manifest){
  const cards=manifest?.cards||[],errors=[],warnings=[],mintSet=new Set(),idSet=new Set();
  cards.forEach((c,i)=>{
    if(!c.name)errors.push(`card ${i}: missing name`);
    if(!Number.isFinite(Number(c.id)))errors.push(`card ${i}: invalid id`);
    if(!/^https:\/\//.test(c.image||''))errors.push(`card ${i}: invalid image URL`);
    if(c.mint){if(mintSet.has(c.mint))errors.push('duplicate mint '+c.mint);mintSet.add(c.mint)}
    if(idSet.has(String(c.id)))errors.push('duplicate id '+c.id);idSet.add(String(c.id));
    if(c.stats!==undefined){try{validateCardStats(c.stats)}catch(e){errors.push('card '+i+': '+e.message)}}
  });
  const expected=Number(manifest?.reportedTotal||manifest?.expectedTotal||0);
  if(expected&&cards.length!==expected)warnings.push(`manifest contains ${cards.length}/${expected} cards`);
  return {valid:errors.length===0,errors,warnings,count:cards.length,expected:expected||null}
}
export function totalCardsInPlay(game){
  return game.decks[0].length+game.decks[1].length+game.pot.length*2
}
