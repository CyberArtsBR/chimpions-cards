export const ATTRIBUTES=['Power','Agility','Intellect','Tech','Mystique','Charisma'];
export const MODES={classic:'classic',tactical:'tactical'};

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

export function legalAttributes(game){
  if(!game||game.finished)return [];
  return ATTRIBUTES.filter(a=>!(game.mode===MODES.tactical&&game.lastAttribute===a));
}

export function createMatch(cards,{deckSize=6,maxRounds=24,mode=MODES.classic,starter=0,rng=Math.random}={}){
  if(!Number.isInteger(deckSize)||deckSize<1)throw new Error('deckSize must be a positive integer');
  if(!Number.isInteger(maxRounds)||maxRounds<1)throw new Error('maxRounds must be a positive integer');
  if(starter!==0&&starter!==1)throw new Error('starter must be 0 or 1');
  if(mode!==MODES.classic&&mode!==MODES.tactical)throw new Error('Invalid mode');
  if(typeof rng!=='function')throw new Error('rng must be a function');
  const decorated=decorateCards(cards);
  validateMatchCards(decorated);
  const pool=shuffled(decorated,rng);
  const n=Math.min(deckSize,Math.floor(pool.length/2));
  if(n<1)throw new Error('Not enough cards to start a match');
  return {
    decks:[pool.slice(0,n),pool.slice(n,n*2)],pot:[],round:1,maxRounds,
    active:starter,mode,
    phase:'choose',lastAttribute:null,result:null,history:[],finished:false,outcome:null,
    swaps:[mode===MODES.tactical?1:0,mode===MODES.tactical?1:0]
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

export function resolveRound(game,attribute,seat){
  if(!game||game.finished)throw new Error('Match finished');
  if(game.phase!=='choose')throw new Error('Round is already resolving');
  if(seat!==game.active)throw new Error('Not your turn');
  if(!legalAttributes(game).includes(attribute))throw new Error('Illegal attribute');
  if(!game.decks[0][0]||!game.decks[1][0])return finishMatch(game);

  const drawn=[game.decks[0].shift(),game.decks[1].shift()];
  const values=drawn.map(c=>c.stats[attribute]);
  let winner=null;
  if(values[0]===values[1]){
    game.pot.push(drawn);
  }else{
    winner=values[0]>values[1]?0:1;
    const loot=[...drawn,...game.pot.flat()];
    game.pot=[];
    game.decks[winner].push(...loot);
  }
  const chooser=game.active;
  if(game.mode===MODES.tactical)game.active=1-chooser;
  else if(winner!==null)game.active=winner;

  game.lastAttribute=attribute;
  game.phase='reveal';
  game.result={cards:drawn,values,winner,attribute,chooser};
  game.history.push({round:game.round,attribute,values,winner,chooser,potPairs:game.pot.length});
  return game.result;
}

export function advanceMatch(game){
  if(!game||game.finished)return game;
  if(game.phase!=='reveal')return game;
  game.result=null;
  game.round+=1;
  game.phase='choose';
  if(!game.decks[0].length||!game.decks[1].length||game.round>game.maxRounds)return finishMatch(game);
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
  game.finished=true; game.phase='finished';
  game.outcome={winner,counts,roundsPlayed:game.history.length,history:[...game.history]};
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

export function chooseCpuAttribute(card,population=[],banned=null){
  const legal=ATTRIBUTES.filter(a=>a!==banned);
  return legal.reduce((best,a)=>{
    const score=attributeWinRate(card,a,population);
    const bestScore=attributeWinRate(card,best,population);
    if(score!==bestScore)return score>bestScore?a:best;
    return card.stats[a]>card.stats[best]?a:best;
  },legal[0]);
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

export function totalCardsInPlay(game){return game.decks[0].length+game.decks[1].length+game.pot.length*2}
