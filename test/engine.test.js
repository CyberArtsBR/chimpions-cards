import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTRIBUTES,MODES,MODE_META,CPU_DIFFICULTIES,cardStats,createMatch,resolveRound,advanceMatch,reserveSwap,setBan,
  legalAttributes,legalWagers,totalCardsInPlay,finishMatch,chooseCpuAttribute,chooseCpuAttributes,chooseCpuBan,chooseCpuWager,
  decorateCards,decorateCard,validateCardStats,chaosModifier
} from '../public/engine.js';

const fixtures=decorateCards(Array.from({length:18},(_,i)=>({id:i+1,mint:`mint-${i+1}`,name:`Chimp ${i+1}`,image:'https://example.com/x.gif',tribe:'Test'})));
const deterministic=()=>0.999999;
const stats=(Power,Agility,Intellect,Tech,Mystique,Charisma)=>({Power,Agility,Intellect,Tech,Mystique,Charisma});
const card=(id,s)=>({...fixtures[id],stats:s});

test('every generated card keeps the exact 360-point budget and bounded stats',()=>{
  for(const c of fixtures){const s=cardStats(c);assert.equal(Object.values(s).reduce((a,b)=>a+b,0),360);for(const v of Object.values(s))assert.ok(v>=34&&v<=86)}
});

test('all six public modes have metadata and can create a match',()=>{
  assert.deepEqual(Object.values(MODES).sort(),['ban-counter','chaos','survivor','tactical','triple','wager']);
  for(const mode of Object.values(MODES)){
    assert.ok(MODE_META[mode]?.icon);assert.ok(MODE_META[mode]?.name);
    const g=createMatch(fixtures,{mode,starter:0,rng:deterministic});
    assert.equal(g.mode,mode);assert.ok(g.decks[0].length>0);assert.ok(g.decks[1].length>0)
  }
});

test('tactical alternates chooser, locks last attribute and allows one reserve swap',()=>{
  const g=createMatch(fixtures,{starter:0,mode:MODES.tactical,rng:deterministic});
  const first=g.decks[0][0].id;reserveSwap(g,0);assert.notEqual(g.decks[0][0].id,first);assert.equal(g.swaps[0],0);
  resolveRound(g,'Power',0);assert.equal(g.active,1);advanceMatch(g);
  assert.ok(!legalAttributes(g).includes('Power'));assert.throws(()=>resolveRound(g,'Power',1),/Illegal attribute/)
});

test('Wager stakes up to three cards and winner captures the whole risk',()=>{
  const g=createMatch(fixtures,{deckSize:5,starter:0,mode:MODES.wager,rng:deterministic});
  g.decks=[
    [card(0,stats(90,50,50,50,50,50)),fixtures[1],fixtures[2],fixtures[3],fixtures[4]],
    [card(5,stats(40,50,50,50,50,50)),fixtures[6],fixtures[7],fixtures[8],fixtures[9]]
  ];
  assert.deepEqual(legalWagers(g),[1,2,3]);
  const r=resolveRound(g,'Power',0,{wager:3});
  assert.equal(r.stake,3);assert.equal(r.winner,0);assert.equal(r.capturedCount,6);
  assert.deepEqual(g.decks.map(d=>d.length),[8,2]);
});

test('Ban & Counter requires the defender to ban before the chooser acts',()=>{
  const g=createMatch(fixtures,{starter:0,mode:MODES.banCounter,rng:deterministic});
  assert.equal(g.phase,'ban');assert.throws(()=>resolveRound(g,'Power',0),/not ready/i);
  assert.throws(()=>setBan(g,'Power',0),/Chooser cannot ban/);
  setBan(g,'Power',1);assert.equal(g.phase,'choose');assert.equal(g.bannedAttribute,'Power');
  assert.ok(!legalAttributes(g).includes('Power'));assert.throws(()=>resolveRound(g,'Power',0),/Illegal attribute/);
  resolveRound(g,'Agility',0);advanceMatch(g);assert.equal(g.phase,'ban');assert.equal(g.bannedAttribute,null)
});

test('Triple Clash resolves three independent attributes and uses the best-of-three score',()=>{
  const g=createMatch(fixtures,{deckSize:2,starter:0,mode:MODES.triple,rng:deterministic});
  g.decks=[
    [card(0,stats(90,80,30,40,40,40)),fixtures[1]],
    [card(2,stats(40,50,95,40,40,40)),fixtures[3]]
  ];
  const r=resolveRound(g,['Power','Agility','Intellect'],0);
  assert.deepEqual(r.values,[2,1]);assert.equal(r.winner,0);assert.equal(r.comparisons.length,3);
  assert.throws(()=>createMatch(fixtures,{mode:'arcade'}),/Invalid mode/)
});

test('Survivor eliminates the loser while the winning Chimpion remains in front',()=>{
  const g=createMatch(fixtures,{deckSize:3,starter:0,mode:MODES.survivor,rng:deterministic});
  g.decks=[
    [card(0,stats(90,50,50,50,50,50)),fixtures[1],fixtures[2]],
    [card(3,stats(40,50,50,50,50,50)),fixtures[4],fixtures[5]]
  ];
  const total=totalCardsInPlay(g),winnerId=g.decks[0][0].id;
  const r=resolveRound(g,'Power',0);
  assert.equal(r.winner,0);assert.equal(r.eliminatedCards.length,1);assert.equal(g.decks[0][0].id,winnerId);
  assert.deepEqual(g.decks.map(d=>d.length),[3,2]);assert.equal(g.eliminated[1].length,1);assert.equal(totalCardsInPlay(g),total)
});

test('Chaos modifiers are deterministic and materially change round rules',()=>{
  assert.deepEqual(chaosModifier(123,4),chaosModifier(123,4));
  const g=createMatch(fixtures,{deckSize:3,starter:0,mode:MODES.chaos,rng:deterministic});
  g.chaos={id:'reverse',icon:'↕️',label:'Reverse Gravity',description:'Lowest wins'};
  g.decks=[
    [card(0,stats(35,50,50,50,50,50)),fixtures[1],fixtures[2]],
    [card(3,stats(85,50,50,50,50,50)),fixtures[4],fixtures[5]]
  ];
  const r=resolveRound(g,'Power',0);assert.equal(r.winner,0);assert.equal(r.modifier.id,'reverse');
  advanceMatch(g);assert.ok(g.chaos?.id)
});

test('Chaos lockout removes one legal attribute and jackpot can steal a reserve card',()=>{
  const g=createMatch(fixtures,{deckSize:4,starter:0,mode:MODES.chaos,rng:deterministic});
  g.chaos={id:'lockout',icon:'🔒',label:'Power Jammed',description:'x',attribute:'Power'};
  assert.ok(!legalAttributes(g).includes('Power'));
  g.chaos={id:'jackpot',icon:'🎁',label:'Bonus Capture',description:'x'};
  g.decks=[
    [card(0,stats(90,50,50,50,50,50)),fixtures[1],fixtures[2],fixtures[3]],
    [card(4,stats(40,50,50,50,50,50)),fixtures[5],fixtures[6],fixtures[7]]
  ];
  const r=resolveRound(g,'Power',0);assert.equal(r.winner,0);assert.ok(r.bonusCapture);assert.equal(r.capturedCount,3);
  assert.deepEqual(g.decks.map(d=>d.length),[6,2])
});

test('standoff pots conserve cards and terminal scoring returns unresolved cards',()=>{
  const equal=decorateCards([
    {id:101,mint:'tie-a',name:'A',image:'https://x/a',stats:stats(60,60,60,60,60,60)},
    {id:102,mint:'tie-b',name:'B',image:'https://x/b',stats:stats(60,60,60,60,60,60)}
  ]);
  const g=createMatch(equal,{deckSize:1,maxRounds:1,starter:0,mode:MODES.tactical,rng:deterministic});
  const total=totalCardsInPlay(g),r=resolveRound(g,'Power',0);assert.equal(r.winner,null);assert.equal(totalCardsInPlay(g),total);
  advanceMatch(g);assert.equal(g.finished,true);assert.deepEqual(g.outcome.counts,[1,1]);assert.equal(g.pot.length,0)
});

test('Expert CPU helpers always return legal moves for specialized modes',()=>{
  const tactical=createMatch(fixtures,{mode:MODES.tactical,starter:1,rng:deterministic});
  tactical.lastAttribute='Power';
  const one=chooseCpuAttribute(tactical.decks[1][0],fixtures,null,{difficulty:CPU_DIFFICULTIES.expert,game:tactical});
  assert.ok(legalAttributes(tactical).includes(one));
  const triple=createMatch(fixtures,{mode:MODES.triple,starter:1,rng:deterministic});
  const three=chooseCpuAttributes(triple,triple.decks[1][0],fixtures,3);assert.equal(three.length,3);assert.equal(new Set(three).size,3);
  const ban=createMatch(fixtures,{mode:MODES.banCounter,starter:0,rng:deterministic});
  assert.ok(ATTRIBUTES.includes(chooseCpuBan(ban,ban.decks[0][0],fixtures)));
  const wager=createMatch(fixtures,{mode:MODES.wager,starter:1,rng:deterministic});
  assert.ok(legalWagers(wager).includes(chooseCpuWager(wager,wager.decks[1][0],fixtures)))
});

test('core validation rejects malformed cards and match options',()=>{
  const valid=stats(60,60,60,60,60,60);
  assert.equal(validateCardStats(valid),true);
  assert.throws(()=>decorateCard({id:90,mint:'bad-empty',name:'Bad',stats:{}}),/exactly six/);
  assert.throws(()=>decorateCard({id:91,mint:'bad-fraction',name:'Bad',stats:{...valid,Power:60.5}}),/Invalid Power/);
  assert.throws(()=>createMatch(fixtures,{deckSize:0}),/deckSize/);
  assert.throws(()=>createMatch(fixtures,{maxRounds:0}),/maxRounds/);
  assert.throws(()=>createMatch(fixtures,{starter:2}),/starter/);
  assert.throws(()=>createMatch(fixtures,{rng:42}),/rng/)
});

test('seeded invariant runs finish legally across every mode',()=>{
  function rng(seed){let x=seed>>>0;return()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296)}
  for(const mode of Object.values(MODES)){
    for(let seed=1;seed<=40;seed++){
      const g=createMatch(fixtures,{starter:seed%2,mode,maxRounds:28,rng:rng(seed)});
      const total=totalCardsInPlay(g);let guard=0;
      while(!g.finished&&guard++<100){
        assert.equal(totalCardsInPlay(g),total);
        if(g.phase==='ban'){
          setBan(g,ATTRIBUTES[seed%ATTRIBUTES.length],1-g.active);
          continue
        }
        if(g.phase==='choose'){
          const legal=legalAttributes(g);let choice=legal[seed%legal.length],opts={};
          if(mode===MODES.triple)choice=legal.slice(0,3);
          if(mode===MODES.wager)opts={wager:legalWagers(g)[0]};
          resolveRound(g,choice,g.active,opts);
        }else advanceMatch(g)
      }
      assert.ok(g.finished);assert.equal(totalCardsInPlay(g),total);assert.equal(g.outcome.roundsPlayed,g.history.length)
    }
  }
});
