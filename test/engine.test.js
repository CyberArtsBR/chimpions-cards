import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTRIBUTES,MODES,cardStats,createMatch,resolveRound,advanceMatch,reserveSwap,legalAttributes,
  totalCardsInPlay,finishMatch,chooseCpuAttribute,decorateCards,decorateCard,validateCardStats
} from '../public/engine.js';

const fixtures=decorateCards(Array.from({length:12},(_,i)=>({id:i+1,mint:`mint-${i+1}`,name:`Chimp ${i+1}`,image:'https://example.com/x.gif',tribe:'Test'})));
const deterministic=()=>0.999999;

test('every generated card keeps the exact 360-point budget and bounded stats',()=>{
  for(const c of fixtures){const s=cardStats(c);assert.equal(Object.values(s).reduce((a,b)=>a+b,0),360);for(const v of Object.values(s))assert.ok(v>=34&&v<=86)}
});

test('production round resolution preserves the exact revealed cards',()=>{
  const g=createMatch(fixtures,{starter:0,rng:deterministic});const expected=[g.decks[0][0],g.decks[1][0]];
  const r=resolveRound(g,ATTRIBUTES[0],0);assert.equal(r.cards[0].id,expected[0].id);assert.equal(r.cards[1].id,expected[1].id)
});

test('card conservation survives decisive rounds and standoff pots',()=>{
  const g=createMatch(fixtures,{starter:0,rng:deterministic});const total=totalCardsInPlay(g);
  resolveRound(g,ATTRIBUTES[0],0);assert.equal(totalCardsInPlay(g),total);advanceMatch(g);assert.equal(totalCardsInPlay(g),total)
});

test('a tie stores both cards and terminal scoring returns them to contributors',()=>{
  const cards=decorateCards([
    {id:1,mint:'tie-a',name:'A',image:'https://x/a',stats:{Power:60,Agility:60,Intellect:60,Tech:60,Mystique:60,Charisma:60}},
    {id:2,mint:'tie-b',name:'B',image:'https://x/b',stats:{Power:60,Agility:60,Intellect:60,Tech:60,Mystique:60,Charisma:60}}
  ]);
  const g=createMatch(cards,{deckSize:1,maxRounds:1,starter:0,rng:deterministic});
  const r=resolveRound(g,'Power',0);assert.equal(r.winner,null);assert.equal(g.pot.length,1);advanceMatch(g);
  assert.equal(g.finished,true);assert.deepEqual(g.outcome.counts,[1,1]);assert.equal(g.outcome.winner,null);assert.equal(g.pot.length,0)
});

test('equal final counts are an explicit draw, never a defeat',()=>{
  const g=createMatch(fixtures,{starter:0,rng:deterministic});g.decks=[fixtures.slice(0,3),fixtures.slice(3,6)];g.pot=[];
  const out=finishMatch(g);assert.equal(out.winner,null);assert.deepEqual(out.counts,[3,3])
});

test('tactical mode alternates initiative and blocks immediate attribute repetition',()=>{
  const g=createMatch(fixtures,{starter:0,mode:'tactical',rng:deterministic});resolveRound(g,'Power',0);assert.equal(g.active,1);advanceMatch(g);
  assert.ok(!legalAttributes(g).includes('Power'));assert.throws(()=>resolveRound(g,'Power',1),/Illegal attribute/)
});

test('tactical reserve swap is single-use and only available to active player',()=>{
  const g=createMatch(fixtures,{starter:0,mode:'tactical',rng:deterministic});const first=g.decks[0][0].id;reserveSwap(g,0);assert.notEqual(g.decks[0][0].id,first);assert.equal(g.swaps[0],0);assert.throws(()=>reserveSwap(g,0),/No reserve swap/)
});

test('turn ownership is enforced by the production engine',()=>{
  const g=createMatch(fixtures,{starter:1,rng:deterministic});assert.throws(()=>resolveRound(g,'Power',0),/Not your turn/)
});

test('CPU choice is legal and distribution-aware',()=>{
  const c=fixtures[0],a=chooseCpuAttribute(c,fixtures,'Power');assert.ok(ATTRIBUTES.includes(a));assert.notEqual(a,'Power')
});


test('custom card stats require exactly six finite integer attributes',()=>{
  const valid={Power:60,Agility:60,Intellect:60,Tech:60,Mystique:60,Charisma:60};
  assert.equal(validateCardStats(valid),true);
  assert.throws(()=>decorateCard({id:90,mint:'bad-empty',name:'Bad',stats:{}}),/exactly six/);
  assert.throws(()=>decorateCard({id:91,mint:'bad-missing',name:'Bad',stats:{...valid,Power:undefined}}),/Invalid Power/);
  assert.throws(()=>decorateCard({id:92,mint:'bad-nan',name:'Bad',stats:{...valid,Power:NaN}}),/Invalid Power/);
  assert.throws(()=>decorateCard({id:93,mint:'bad-inf',name:'Bad',stats:{...valid,Power:Infinity}}),/Invalid Power/);
  assert.throws(()=>decorateCard({id:94,mint:'bad-fraction',name:'Bad',stats:{...valid,Power:60.5}}),/Invalid Power/);
});

test('match options reject invalid numeric, starter, mode, rng, and duplicate identities',()=>{
  assert.throws(()=>createMatch(fixtures,{deckSize:NaN}),/deckSize/);
  assert.throws(()=>createMatch(fixtures,{deckSize:0}),/deckSize/);
  assert.throws(()=>createMatch(fixtures,{deckSize:1.5}),/deckSize/);
  assert.throws(()=>createMatch(fixtures,{maxRounds:0}),/maxRounds/);
  assert.throws(()=>createMatch(fixtures,{maxRounds:2.5}),/maxRounds/);
  assert.throws(()=>createMatch(fixtures,{starter:2}),/starter/);
  assert.throws(()=>createMatch(fixtures,{mode:'arcade'}),/Invalid mode/);
  assert.throws(()=>createMatch(fixtures,{rng:42}),/rng/);
  const dup=[...fixtures.slice(0,2),{...fixtures[2],mint:fixtures[0].mint,id:999}];
  assert.throws(()=>createMatch(dup,{deckSize:1}),/Duplicate competitive identity/);
});

test('resolved history is the source of truth for roundsPlayed, including finish during reveal',()=>{
  const g=createMatch(fixtures,{starter:0,rng:deterministic});
  resolveRound(g,'Power',0);
  assert.equal(g.history.length,1);
  const out=finishMatch(g);
  assert.equal(out.roundsPlayed,1);
  assert.equal(out.roundsPlayed,out.history.length);
  assert.equal(finishMatch(g),out);
});

test('seeded invariant runs conserve cards and reject invalid mutations',()=>{
  function rng(seed){let x=seed>>>0;return()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296)}
  for(let seed=1;seed<=250;seed++){
    const mode=seed%2?MODES.tactical:MODES.classic;
    const g=createMatch(fixtures,{starter:seed%2,mode,deckSize:6,maxRounds:40,rng:rng(seed)});
    const total=totalCardsInPlay(g);
    let guard=0;
    while(!g.finished&&guard++<120){
      assert.equal(totalCardsInPlay(g),total);
      assert.ok(g.active===0||g.active===1);
      if(g.phase==='choose'){
        const legal=legalAttributes(g);
        assert.ok(legal.length>0);
        const before=JSON.stringify(g);
        const wrongSeat=1-g.active;
        assert.throws(()=>resolveRound(g,legal[0],wrongSeat),/Not your turn/);
        assert.equal(JSON.stringify(g),before);
        resolveRound(g,legal[seed%legal.length],g.active);
        assert.equal(totalCardsInPlay(g),total);
      }else{
        advanceMatch(g);
      }
    }
    assert.ok(g.finished);
    assert.equal(totalCardsInPlay(g),total);
    assert.equal(g.outcome.roundsPlayed,g.history.length);
    const snapshot=JSON.stringify(g);
    assert.throws(()=>resolveRound(g,'Power',g.active),/Match finished/);
    assert.equal(JSON.stringify(g),snapshot);
  }
});
