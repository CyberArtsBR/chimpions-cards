import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTRIBUTES,MODES,MODE_META,CPU_DIFFICULTIES,cardStats,createMatch,resolveRound,advanceMatch,reserveSwap,setBan,
  legalAttributes,totalCardsInPlay,chooseCpuAttribute,chooseCpuAttributes,chooseCpuBan,chooseCpuTeamAttribute,
  decorateCards,decorateCard,validateCardStats
} from '../public/engine.js';

const fixtures=decorateCards(Array.from({length:48},(_,i)=>({id:i+1,mint:`mint-${i+1}`,name:`Chimp ${i+1}`,image:'https://example.com/x.gif',tribe:'Test'})));
const deterministic=()=>0.999999;
const stats=(Power,Agility,Intellect,Tech,Mystique,Charisma)=>({Power,Agility,Intellect,Tech,Mystique,Charisma});
const card=(id,s)=>({...fixtures[id],stats:s});

test('generated cards keep the 360-point budget and bounded stats',()=>{
  for(const c of fixtures){const s=cardStats(c);assert.equal(Object.values(s).reduce((a,b)=>a+b,0),360);for(const v of Object.values(s))assert.ok(v>=34&&v<=86)}
});

test('only the four requested public modes exist',()=>{
  assert.deepEqual(Object.values(MODES).sort(),['ban-counter','tactical','team-tag','triple']);
  for(const mode of Object.values(MODES)){assert.ok(MODE_META[mode]?.icon);assert.ok(MODE_META[mode]?.name);assert.equal(createMatch(fixtures,{mode,starter:0,rng:deterministic}).mode,mode)}
  assert.throws(()=>createMatch(fixtures,{mode:'chaos'}),/Invalid mode/);
  assert.throws(()=>createMatch(fixtures,{mode:'wager'}),/Invalid mode/);
  assert.throws(()=>createMatch(fixtures,{mode:'survivor'}),/Invalid mode/)
});

test('Tactical alternates chooser, locks last attribute and supports one reserve swap',()=>{
  const g=createMatch(fixtures,{starter:0,mode:MODES.tactical,rng:deterministic});
  const first=g.decks[0][0].id;reserveSwap(g,0);assert.notEqual(g.decks[0][0].id,first);assert.equal(g.swaps[0],0);
  resolveRound(g,'Power',0);assert.equal(g.active,1);advanceMatch(g);assert.ok(!legalAttributes(g).includes('Power'))
});

test('Ban & Counter requires defender ban before chooser',()=>{
  const g=createMatch(fixtures,{starter:0,mode:MODES.banCounter,rng:deterministic});
  assert.equal(g.phase,'ban');setBan(g,'Power',1);assert.equal(g.phase,'choose');assert.ok(!legalAttributes(g).includes('Power'));
  assert.throws(()=>resolveRound(g,'Power',0),/Illegal attribute/);resolveRound(g,'Agility',0);advanceMatch(g);assert.equal(g.phase,'ban')
});

test('Triple Clash resolves best of three',()=>{
  const g=createMatch(fixtures,{deckSize:2,starter:0,mode:MODES.triple,rng:deterministic});
  g.decks=[[card(0,stats(90,80,30,40,40,40)),fixtures[1]],[card(2,stats(40,50,95,40,40,40)),fixtures[3]]];
  const r=resolveRound(g,['Power','Agility','Intellect'],0);assert.deepEqual(r.values,[2,1]);assert.equal(r.winner,0);assert.equal(r.comparisons.length,3)
});

test('Team Tag always deals exactly 20 cards per player',()=>{
  const g=createMatch(fixtures,{starter:0,mode:MODES.teamTag,rng:deterministic});
  assert.deepEqual(g.decks.map(d=>d.length),[20,20]);
  assert.throws(()=>createMatch(fixtures.slice(0,39),{mode:MODES.teamTag,rng:deterministic}),/requires at least 40/)
});

test('Team Tag win: same player owns top two, captures enemy pair, and keeps initiative',()=>{
  const g=createMatch(fixtures,{starter:0,mode:MODES.teamTag,rng:deterministic});
  g.decks[0][0]=card(0,stats(95,50,50,50,50,50));g.decks[0][1]=card(1,stats(88,50,50,50,50,50));
  g.decks[1][0]=card(20,stats(70,50,50,50,50,50));g.decks[1][1]=card(21,stats(65,50,50,50,50,50));
  const total=totalCardsInPlay(g),r=resolveRound(g,'Power',0);
  assert.equal(r.winner,0);assert.equal(r.capturedCount,2);assert.equal(r.capturedCards.length,2);
  assert.deepEqual(r.teamValues,[[95,88],[70,65]]);assert.equal(r.rankings[0].seat,0);assert.equal(r.rankings[1].seat,0);
  assert.deepEqual(g.decks.map(d=>d.length),[22,18]);assert.equal(g.active,0);assert.equal(totalCardsInPlay(g),total)
});

test('Team Tag draw: split top two returns pairs to own decks and passes initiative',()=>{
  const g=createMatch(fixtures,{starter:0,mode:MODES.teamTag,rng:deterministic});
  const pIds=g.decks[0].slice(0,2).map(c=>c.id),oIds=g.decks[1].slice(0,2).map(c=>c.id);
  g.decks[0][0]=card(0,stats(95,50,50,50,50,50));g.decks[0][1]=card(1,stats(60,50,50,50,50,50));
  g.decks[1][0]=card(20,stats(90,50,50,50,50,50));g.decks[1][1]=card(21,stats(55,50,50,50,50,50));
  const r=resolveRound(g,'Power',0);
  assert.equal(r.winner,null);assert.equal(r.capturedCount,0);assert.deepEqual(g.decks.map(d=>d.length),[20,20]);assert.equal(g.active,1);
  assert.notDeepEqual(g.decks[0].slice(0,2).map(c=>c.id),pIds);assert.notDeepEqual(g.decks[1].slice(0,2).map(c=>c.id),oIds)
});

test('Team Tag tie at second-place cutoff is a draw',()=>{
  const g=createMatch(fixtures,{starter:1,mode:MODES.teamTag,rng:deterministic});
  g.decks[0][0]=card(0,stats(95,50,50,50,50,50));g.decks[0][1]=card(1,stats(80,50,50,50,50,50));
  g.decks[1][0]=card(20,stats(80,50,50,50,50,50));g.decks[1][1]=card(21,stats(70,50,50,50,50,50));
  const r=resolveRound(g,'Power',1);assert.equal(r.winner,null);assert.equal(g.active,0)
});

test('Expert CPU Team Tag chooser returns the strongest legal team attribute',()=>{
  const g=createMatch(fixtures,{starter:1,mode:MODES.teamTag,rng:deterministic});
  const a=chooseCpuTeamAttribute(g,1,fixtures);assert.ok(ATTRIBUTES.includes(a));
  const normal=createMatch(fixtures,{starter:1,mode:MODES.tactical,rng:deterministic});
  assert.ok(ATTRIBUTES.includes(chooseCpuAttribute(normal.decks[1][0],fixtures,null,{difficulty:CPU_DIFFICULTIES.expert,game:normal})));
  const triple=createMatch(fixtures,{starter:1,mode:MODES.triple,rng:deterministic});assert.equal(chooseCpuAttributes(triple,triple.decks[1][0],fixtures,3).length,3);
  const ban=createMatch(fixtures,{starter:0,mode:MODES.banCounter,rng:deterministic});assert.ok(ATTRIBUTES.includes(chooseCpuBan(ban,ban.decks[0][0],fixtures)))
});

test('core validation rejects malformed cards and options',()=>{
  const valid=stats(60,60,60,60,60,60);assert.equal(validateCardStats(valid),true);
  assert.throws(()=>decorateCard({id:90,mint:'bad',name:'Bad',stats:{}}),/exactly six/);
  assert.throws(()=>createMatch(fixtures,{deckSize:0}),/deckSize/);assert.throws(()=>createMatch(fixtures,{starter:2}),/starter/)
});

test('seeded invariant runs conserve cards across all four modes',()=>{
  function rng(seed){let x=seed>>>0;return()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296)}
  for(const mode of Object.values(MODES)){
    for(let seed=1;seed<=25;seed++){
      const g=createMatch(fixtures,{starter:seed%2,mode,maxRounds:mode===MODES.teamTag?60:28,rng:rng(seed)}),total=totalCardsInPlay(g);let guard=0;
      while(!g.finished&&guard++<120){
        assert.equal(totalCardsInPlay(g),total);
        if(g.phase==='ban'){setBan(g,ATTRIBUTES[seed%ATTRIBUTES.length],1-g.active);continue}
        if(g.phase==='choose'){
          const legal=legalAttributes(g);let choice=legal[seed%legal.length];
          if(mode===MODES.triple)choice=legal.slice(0,3);
          resolveRound(g,choice,g.active)
        }else advanceMatch(g)
      }
      assert.ok(g.finished);assert.equal(totalCardsInPlay(g),total)
    }
  }
});
