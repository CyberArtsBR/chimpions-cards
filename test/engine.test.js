import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTRIBUTES,cardStats,createMatch,resolveRound,advanceMatch,reserveSwap,legalAttributes,
  totalCardsInPlay,finishMatch,chooseCpuAttribute,decorateCards
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
    {id:1,mint:'same',name:'A',image:'https://x/a'},
    {id:2,mint:'same',name:'B',image:'https://x/b'}
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
