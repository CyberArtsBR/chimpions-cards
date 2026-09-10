export const ATTRIBUTES=['Power','Agility','Intellect','Tech','Mystique','Charisma'];
export const MODES={
  tactical:'tactical',
  wager:'wager',
  banCounter:'ban-counter',
  triple:'triple',
  survivor:'survivor',
  chaos:'chaos'
};
export const MODE_META={
  [MODES.tactical]:{icon:'🧠',name:'Tactical',tagline:'Competitive control',description:'Alternating turns, one reserve swap, and the last-used attribute locks for one round.',deckSize:6},
  [MODES.wager]:{icon:'💎',name:'Wager',tagline:'Risk it for the pot',description:'Stake 1–3 cards before the duel. The visible lead card decides who takes the entire stake.',deckSize:8},
  [MODES.banCounter]:{icon:'🚫',name:'Ban & Counter',tagline:'Read the rival',description:'The defender bans one attribute before the chooser locks the duel.',deckSize:6},
  [MODES.triple]:{icon:'⚔️',name:'Triple Clash',tagline:'Best of three stats',description:'Choose three attributes. Win at least two comparisons to capture the round.',deckSize:6},
  [MODES.survivor]:{icon:'☠️',name:'Survivor',tagline:'Last squad standing',description:'Losers are eliminated instead of captured. The winning Chimpion stays to fight again.',deckSize:6},
  [MODES.chaos]:{icon:'🌀',name:'Chaos',tagline:'Rules mutate every round',description:'A new arena modifier changes the duel every round: reverse wins, lockouts, bonus captures and more.',deckSize:7}
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
      if(next>=min&&next<=max){out[i]=next;delta-=step;changed=true;if(delta===0)break;}
    }
    if(!changed)break;
  }
  return out;
}

export function cardStats(card){
  const seed=card?.mint||`${card?.id||''}:${card?.name||''}`;
  let x=hashString(seed);
  const raw=ATTRIBUTES.map(()=>{
    x=(Math.imul(x,1664525)+1013904223)>>>0;
    return 38+(x%45);
  });
  const maxI=raw.indexOf(Math.max(...raw)),minI=raw.indexOf(Math.min(...raw));
  raw[maxI]+=8; raw[minI]-=8;
  const vals=rebalance(raw);
  return Object.fromEntries(ATTRIBUTES.map((a,i)=>[a,vals[i]]));
}

export function validateCardStats(stats){
  if(!stats||typeof stats!=='object'||Array.isArray(stats))throw new Error('Card stats must be an object');
  const keys=Object.keys(stats);
  if(keys.length!==ATTRIBUTES.length||ATTRIBUTES.some(a=>!Object.hasOwn(stats,a)))throw new Error('Card stats must contain exactly six attributes');
  for(const a of ATTRIBUTES){
    const v=stats[a];
    if(!Number.isFinite(v)||!Number.isInteger(v)||v<0||v>100)throw new Error('Invalid '+a+' stat');
  }
  return true;
}
export function decorateCard(card){
  if(!card||typeof card!=='object')throw new Error('Invalid card');
  const stats=card.stats??cardStats(card);
  validateCardStats(stats);
  return {...card,stats:{...stats}};
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
    seen.add(identity);
  }
}

export function shuffled(input=[],rng=Math.random){
  const a=[...input];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]}
  return a;
}

function isMode(mode){return Object.values(MODES).includes(mode)}

const CHAOS_TYPES=['reverse','underdog','crosswire','close-call','lockout','jackpot'];
export function chaosModifier(seed=1,round=1){
  const type=CHAOS_TYPES[hashString(`${seed}:${round}:type`)%CHAOS_TYPES.length];
  if(type==='reverse')return {id:type,icon:'↕️',label:'Reverse Gravity',description:'Lowest value wins this round.'};
  if(type==='underdog')return {id:type,icon:'🩹',label:'Underdog Boost',description:'Each Chimpion’s weakest attribute gets +20 for this duel.'};
  if(type==='crosswire')return {id:type,icon:'🔀',label:'Crosswire',description:'The chosen stat is averaged with the next attribute.'};
  if(type==='close-call')return {id:type,icon:'⚡',label:'Sudden Tie',description:'A margin of 5 or less becomes a standoff.'};
  if(type==='jackpot')return {id:type,icon:'🎁',label:'Bonus Capture',description:'The winner steals one extra reserve card when available.'};
  const attribute=ATTRIBUTES[hashString(`${seed}:${round}:attribute`)%ATTRIBUTES.length];
  return {id:type,icon:'🔒',label:`${attribute} Jammed`,description:`${attribute} cannot be selected this round.`,attribute};
}

function weakestAttribute(card){
  return ATTRIBUTES.reduce((best,a)=>card.stats[a]<card.stats[best]?a:best,ATTRIBUTES[0]);
}
export function effectiveValue(game,card,attribute){
  let value=card.stats[attribute];
  const mod=game?.mode===MODES.chaos?game.chaos:null;
  if(mod?.id==='underdog'&&attribute===weakestAttribute(card))value=Math.min(100,value+20);
  if(mod?.id==='crosswire'){
    const i=ATTRIBUTES.indexOf(attribute),next=ATTRIBUTES[(i+1)%ATTRIBUTES.length];
    value=Math.round((value+card.stats[next])/2);
  }
  return value;
}
function compareAttribute(game,left,right,attribute){
  const values=[effectiveValue(game,left,attribute),effectiveValue(game,right,attribute)];
  let winner=null;
  if(values[0]!==values[1]){
    if(game?.mode===MODES.chaos&&game.chaos?.id==='reverse')winner=values[0]<values[1]?0:1;
    else winner=values[0]>values[1]?0:1;
  }
  if(game?.mode===MODES.chaos&&game.chaos?.id==='close-call'&&Math.abs(values[0]-values[1])<=5)winner=null;
  return {attribute,values,winner};
}

export function legalAttributes(game){
  if(!game||game.finished)return [];
  return ATTRIBUTES.filter(a=>{
    if(game.mode===MODES.tactical&&game.lastAttribute===a)return false;
    if(game.mode===MODES.banCounter&&game.bannedAttribute===a)return false;
    if(game.mode===MODES.chaos&&game.chaos?.id==='lockout'&&game.chaos.attribute===a)return false;
    return true
  });
}
export function legalWagers(game){
  if(!game||game.finished||game.mode!==MODES.wager)return [1];
  const max=Math.max(1,Math.min(3,game.decks[0].length,game.decks[1].length));
  return Array.from({length:max},(_,i)=>i+1)
}

export function createMatch(cards,{deckSize=null,maxRounds=24,mode=MODES.tactical,starter=0,rng=Math.random}={}){
  if(deckSize!==null&&(!Number.isInteger(deckSize)||deckSize<1))throw new Error('deckSize must be a positive integer');
  if(!Number.isInteger(maxRounds)||maxRounds<1)throw new Error('maxRounds must be a positive integer');
  if(starter!==0&&starter!==1)throw new Error('starter must be 0 or 1');
  if(!isMode(mode))throw new Error('Invalid mode');
  if(typeof rng!=='function')throw new Error('rng must be a function');
  const decorated=decorateCards(cards);
  validateMatchCards(decorated);
  const pool=shuffled(decorated,rng);
  const requested=deckSize??MODE_META[mode].deckSize;
  const n=Math.min(requested,Math.floor(pool.length/2));
  if(n<1)throw new Error('Not enough cards to start a match');
  const chaosSeed=Math.floor(Math.max(0,Math.min(.999999999,Number(rng())))*4294967296)>>>0;
  return {
    decks:[pool.slice(0,n),pool.slice(n,n*2)],pot:[],eliminated:[[],[]],round:1,maxRounds,
    active:starter,mode,
    phase:mode===MODES.banCounter?'ban':'choose',
    lastAttribute:null,bannedAttribute:null,wager:1,
    result:null,history:[],finished:false,outcome:null,
    swaps:[mode===MODES.tactical?1:0,mode===MODES.tactical?1:0],
    chaosSeed,chaos:mode===MODES.chaos?chaosModifier(chaosSeed,1):null
  };
}

export function reserveSwap(game,seat){
  if(!game||game.finished||game.phase!=='choose')throw new Error('Swap unavailable now');
  if(game.mode!==MODES.tactical)throw new Error('Reserve swap is tactical-only');
  if(seat!==game.active)throw new Error('Not your turn');
  if(!game.swaps[seat])throw new Error('No reserve swap remaining');
  if(game.decks[seat].length<2)throw new Error('Not enough cards to swap');
  game.decks[seat].push(game.decks[seat].shift());
  game.swaps[seat]-=1;
  return game;
}

export function setBan(game,attribute,seat){
  if(!game||game.finished)throw new Error('Match finished');
  if(game.mode!==MODES.banCounter||game.phase!=='ban')throw new Error('Ban unavailable now');
  if(seat===game.active)throw new Error('Chooser cannot ban');
  if(seat!==1-game.active)throw new Error('Not the defender');
  if(!ATTRIBUTES.includes(attribute))throw new Error('Invalid attribute');
  game.bannedAttribute=attribute;
  game.phase='choose';
  return game;
}

function validateChoice(game,choice){
  const legal=legalAttributes(game);
  if(game.mode===MODES.triple){
    if(!Array.isArray(choice)||choice.length!==3||new Set(choice).size!==3||choice.some(a=>!legal.includes(a)))throw new Error('Triple Clash requires three legal attributes');
    return [...choice];
  }
  if(typeof choice!=='string'||!legal.includes(choice))throw new Error('Illegal attribute');
  return [choice];
}

export function resolveRound(game,choice,seat,{wager=1}={}){
  if(!game||game.finished)throw new Error('Match finished');
  if(game.phase!=='choose')throw new Error('Round is not ready for a duel');
  if(seat!==game.active)throw new Error('Not your turn');
  const attributes=validateChoice(game,choice);
  if(!game.decks[0][0]||!game.decks[1][0])return finishMatch(game);

  const countsBefore=game.decks.map(d=>d.length);
  const chooser=game.active;
  let stake=1,capturedCount=0,capturedCards=[],eliminatedCards=[],bonusCapture=null;
  if(game.mode===MODES.wager){
    if(!Number.isInteger(wager)||!legalWagers(game).includes(wager))throw new Error('Illegal wager');
    stake=wager;
  }

  let staked,primary;
  if(game.mode===MODES.survivor){
    staked=[[game.decks[0][0]],[game.decks[1][0]]];
    primary=[staked[0][0],staked[1][0]];
  }else{
    staked=[game.decks[0].splice(0,stake),game.decks[1].splice(0,stake)];
    primary=[staked[0][0],staked[1][0]];
  }

  let values,winner=null,comparisons=[];
  if(game.mode===MODES.triple){
    comparisons=attributes.map(a=>compareAttribute(game,primary[0],primary[1],a));
    const wins=[comparisons.filter(x=>x.winner===0).length,comparisons.filter(x=>x.winner===1).length];
    values=wins;
    if(wins[0]!==wins[1])winner=wins[0]>wins[1]?0:1;
  }else{
    const compared=compareAttribute(game,primary[0],primary[1],attributes[0]);
    comparisons=[compared];values=compared.values;winner=compared.winner;
  }

  if(game.mode===MODES.survivor){
    if(winner!==null){
      const loser=1-winner;
      eliminatedCards=[game.decks[loser].shift()];
      game.eliminated[loser].push(...eliminatedCards);
    }
  }else if(winner===null){
    for(let i=0;i<stake;i++)game.pot.push([staked[0][i],staked[1][i]]);
  }else{
    const loot=[...staked[0],...staked[1],...game.pot.flat()];
    game.pot=[];
    if(game.mode===MODES.chaos&&game.chaos?.id==='jackpot'){
      const loser=1-winner;
      if(game.decks[loser].length){bonusCapture=game.decks[loser].shift();loot.push(bonusCapture)}
    }
    capturedCards=loot;
    capturedCount=loot.length;
    game.decks[winner].push(...loot);
  }

  game.active=1-chooser;
  game.lastAttribute=game.mode===MODES.tactical?attributes[0]:null;
  game.phase='reveal';
  const attribute=game.mode===MODES.triple?'Triple Clash':attributes[0];
  game.result={
    cards:primary,capturedCards,eliminatedCards,values,winner,attribute,attributes,comparisons,
    chooser,countsBefore,capturedCount,stake,bonusCapture,modifier:game.chaos?{...game.chaos}:null,
    bannedAttribute:game.bannedAttribute
  };
  game.history.push({
    round:game.round,mode:game.mode,attribute,attributes:[...attributes],values:[...values],winner,chooser,
    potPairs:game.pot.length,stake,modifier:game.chaos?.id||null,bannedAttribute:game.bannedAttribute
  });
  return game.result;
}

export function advanceMatch(game){
  if(!game||game.finished)return game;
  if(game.phase!=='reveal')return game;
  game.result=null;
  game.round+=1;
  if(!game.decks[0].length||!game.decks[1].length||game.round>game.maxRounds)return finishMatch(game);
  game.bannedAttribute=null;
  game.wager=1;
  if(game.mode===MODES.chaos)game.chaos=chaosModifier(game.chaosSeed,game.round);
  game.phase=game.mode===MODES.banCounter?'ban':'choose';
  return game;
}

export function returnUnresolvedPot(game){
  if(!game?.pot?.length)return;
  for(const pair of game.pot){
    if(pair[0])game.decks[0].push(pair[0]);
    if(pair[1])game.decks[1].push(pair[1]);
  }
  game.pot=[];
}

export function finishMatch(game){
  if(game.finished)return game.outcome;
  returnUnresolvedPot(game);
  const counts=game.decks.map(d=>d.length);
  const winner=counts[0]===counts[1]?null:(counts[0]>counts[1]?0:1);
  game.finished=true;game.phase='finished';
  game.outcome={
    winner,counts,roundsPlayed:game.history.length,history:[...game.history],
    eliminated:game.eliminated?.map(x=>x.length)||[0,0],mode:game.mode
  };
  return game.outcome;
}

export function attributeWinRate(card,attribute,population=[]){
  const value=card.stats[attribute];
  let wins=0,ties=0,total=0;
  for(const rival of population){
    if(rival===card)continue;
    total++;
    if(value>rival.stats[attribute])wins++;
    else if(value===rival.stats[attribute])ties++;
  }
  return total?(wins+ties*.5)/total:.5;
}
export function attributeWinRateForGame(game,card,attribute,population=[]){
  let wins=0,ties=0,total=0;
  for(const rival of population){
    if(rival===card)continue;
    total++;
    const r=compareAttribute(game,card,rival,attribute);
    if(r.winner===0)wins++;else if(r.winner===null)ties++;
  }
  return total?(wins+ties*.5)/total:.5;
}

function scoredAttributes(card,population,banned,{game=null,rng=Math.random,difficulty=CPU_DIFFICULTIES.expert}={}){
  if(!Object.values(CPU_DIFFICULTIES).includes(difficulty))throw new Error('Invalid CPU difficulty');
  if(typeof rng!=='function')throw new Error('rng must be a function');
  const legal=(game?legalAttributes(game):ATTRIBUTES).filter(a=>a!==banned);
  return legal.map(attribute=>({
    attribute,
    score:game?attributeWinRateForGame(game,card,attribute,population):attributeWinRate(card,attribute,population),
    value:game?effectiveValue(game,card,attribute):card.stats[attribute]
  }));
}
export function chooseCpuAttribute(card,population=[],banned=null,{difficulty=CPU_DIFFICULTIES.expert,rng=Math.random,game=null}={}){
  const scored=scoredAttributes(card,population,banned,{difficulty,rng,game});
  if(!scored.length)throw new Error('No legal attribute');
  if(difficulty===CPU_DIFFICULTIES.easy){
    const weights=scored.map(x=>0.7+x.score*0.6),total=weights.reduce((a,b)=>a+b,0);
    let roll=Math.max(0,Math.min(.999999999,Number(rng()))) * total;
    for(let i=0;i<scored.length;i++){roll-=weights[i];if(roll<=0)return scored[i].attribute}
    return scored.at(-1).attribute
  }
  if(difficulty===CPU_DIFFICULTIES.standard){
    return scored.reduce((best,x)=>{
      const noisy=x.score+(Math.max(0,Math.min(1,Number(rng())))-.5)*.22;
      return !best||noisy>best.noisy||(noisy===best.noisy&&x.value>best.value)?{...x,noisy}:best
    },null).attribute
  }
  return scored.reduce((best,x)=>{
    if(!best||x.score>best.score||(x.score===best.score&&x.value>best.value))return x;
    return best
  },null).attribute;
}
export function chooseCpuAttributes(game,card,population=[],count=3){
  const scored=scoredAttributes(card,population,null,{game,difficulty:CPU_DIFFICULTIES.expert,rng:Math.random});
  return scored.sort((a,b)=>b.score-a.score||b.value-a.value).slice(0,count).map(x=>x.attribute)
}
export function chooseCpuBan(game,opponentCard,population=[]){
  const candidates=ATTRIBUTES.map(attribute=>({attribute,score:attributeWinRate(opponentCard,attribute,population),value:opponentCard.stats[attribute]}));
  return candidates.sort((a,b)=>b.score-a.score||b.value-a.value)[0].attribute
}
export function chooseCpuWager(game,card,population=[]){
  const legal=legalWagers(game);
  const best=legalAttributes(game).reduce((score,a)=>Math.max(score,attributeWinRateForGame(game,card,a,population)),0);
  const target=best>=.72?3:best>=.58?2:1;
  return Math.max(1,Math.min(target,legal.at(-1)||1))
}

export function validateCollection(manifest){
  const cards=manifest?.cards||[],errors=[],warnings=[];
  const mintSet=new Set(),idSet=new Set();
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
  return {valid:errors.length===0,errors,warnings,count:cards.length,expected:expected||null};
}

export function totalCardsInPlay(game){
  return game.decks[0].length+game.decks[1].length+game.pot.length*2+
    (game.eliminated?.[0]?.length||0)+(game.eliminated?.[1]?.length||0)
}
