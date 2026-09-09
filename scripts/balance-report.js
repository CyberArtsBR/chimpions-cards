import {readFile} from 'node:fs/promises';
import {ATTRIBUTES,MODES,decorateCards,attributeWinRate,createMatch,resolveRound,advanceMatch,chooseCpuAttribute} from '../public/engine.js';
const manifest=JSON.parse(await readFile(process.argv[2]||'public/data/chimpions.json','utf8')),cards=decorateCards(manifest.cards||[]);
const round=n=>Math.round(n*1000)/1000,mean=a=>a.reduce((x,y)=>x+y,0)/(a.length||1),median=a=>{a=[...a].sort((x,y)=>x-y);return a.length%2?a[a.length>>1]:(a[a.length/2-1]+a[a.length/2])/2};
const distributions=Object.fromEntries(ATTRIBUTES.map(a=>{const v=cards.map(c=>c.stats[a]);return [a,{min:Math.min(...v),mean:round(mean(v)),median:round(median(v)),max:Math.max(...v),unique:new Set(v).size}]}));
const strength=cards.map(c=>{const rates=ATTRIBUTES.map(a=>attributeWinRate(c,a,cards));return {id:c.id,name:c.name,best:round(Math.max(...rates)),average:round(mean(rates))}}).sort((a,b)=>b.best-a.best);
function rng(seed){let x=seed>>>0;return()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296)}
function sim(mode,seed,starter){const g=createMatch(cards,{deckSize:Math.min(12,Math.floor(cards.length/2)),maxRounds:60,mode,starter,rng:rng(seed)});let guard=0;while(!g.finished&&guard++<200){const seat=g.active,card=g.decks[seat][0],banned=g.mode===MODES.tactical?g.lastAttribute:null,a=chooseCpuAttribute(card,cards,banned);resolveRound(g,a,seat);advanceMatch(g)}return g.outcome?.winner??null}
function starterStudy(mode,runs=200){let starterWins=0,otherWins=0,draws=0;for(let i=1;i<=runs;i++){const w=sim(mode,i,0);if(w===0)starterWins++;else if(w===1)otherWins++;else draws++}return {runs,starterWinRate:round(starterWins/runs),otherWinRate:round(otherWins/runs),drawRate:round(draws/runs)}}
const report={cards:cards.length,expected:manifest.reportedTotal||manifest.expectedTotal||null,provisional:cards.length!==(manifest.reportedTotal||manifest.expectedTotal||cards.length),statBudget:360,bounds:[34,86],distributions,strongestByBestAttribute:strength.slice(0,10),weakestByBestAttribute:strength.slice(-10).reverse(),starterStudy:{classic:starterStudy(MODES.classic),tactical:starterStudy(MODES.tactical)}};
console.log(JSON.stringify(report,null,2));
