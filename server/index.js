import http from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {randomInt} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {fileURLToPath} from 'node:url';
import {
  ATTRIBUTES,MODES,decorateCards,createMatch,legalAttributes,resolveRound,advanceMatch,
  reserveSwap,chooseCpuAttribute
} from '../public/engine.js';

const root=fileURLToPath(new URL('../public/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.mp3':'audio/mpeg','.mp4':'video/mp4','.jpg':'image/jpeg'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://local');
    if(url.pathname==='/healthz'){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});return res.end(JSON.stringify({ok:true,service:'chimpions-arena'}))}
    let p=normalize(url.pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    if(p==='/')p='/index.html';const f=join(root,p);if(!(await stat(f)).isFile())throw new Error('not-file');
    const {size}=await stat(f);
    const headers={'content-type':mime[extname(f)]||'application/octet-stream','cache-control':['.html','.js','.css'].includes(extname(f))?'no-cache':'public,max-age=3600','accept-ranges':'bytes'};
    let start=0,end=size-1,status=200;
    if(req.headers.range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(match&&(match[1]||match[2])){
        start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
        end=match[1]&&match[2]?Math.min(size-1,Number(match[2])):size-1;
      }else start=NaN;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){
        res.writeHead(416,{...headers,'content-range':`bytes */${size}`});return res.end();
      }
      status=206;headers['content-range']=`bytes ${start}-${end}/${size}`;
    }
    headers['content-length']=Math.max(0,end-start+1);
    res.writeHead(status,headers);
    if(req.method==='HEAD'||size===0)return res.end();
    const stream=createReadStream(f,{start,end});
    stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch{res.writeHead(404);res.end('Not found')}
});

const manifest=JSON.parse(await readFile(join(root,'data/chimpions.json'),'utf8'));
const cards=decorateCards(manifest.cards||[]);
const wss=new WebSocketServer({server,path:'/room'}),rooms=new Map();
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ',TURN_MS=20_000,REVEAL_MS=2_200,WAITING_TTL=10*60_000,FINISHED_TTL=90_000;

function roomCode(){return Array.from({length:4},()=>ALPHABET[randomInt(ALPHABET.length)]).join('')}
function send(ws,type,data={}){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type,...data}))}
function peers(room){return room?.players||[]}
function clearRoomTimers(room){if(!room)return;if(room.turnTimer)clearTimeout(room.turnTimer);if(room.revealTimer)clearTimeout(room.revealTimer);if(room.gcTimer)clearTimeout(room.gcTimer);room.turnTimer=room.revealTimer=room.gcTimer=null}
function destroyRoom(code,reason=null){const room=rooms.get(code);if(!room)return;clearRoomTimers(room);if(reason)peers(room).forEach(p=>send(p,'left',{reason}));for(const p of peers(room))if(p.room===code)p.room=null;rooms.delete(code)}
function scheduleGc(room,ms){if(room.gcTimer)clearTimeout(room.gcTimer);room.gcTimer=setTimeout(()=>destroyRoom(room.code),ms)}

function publicState(room,seat){
  const g=room.game;
  return {
    card:g.decks[seat][0],counts:[g.decks[seat].length,g.decks[1-seat].length],round:g.round,maxRounds:g.maxRounds,
    pot:g.pot.length*2,turn:g.active===seat,mode:g.mode,lastAttribute:g.lastAttribute,legal:legalAttributes(g),swaps:[g.swaps[seat],g.swaps[1-seat]],deadline:room.deadline
  }
}
function broadcastState(room){peers(room).forEach((p,i)=>send(p,'state',publicState(room,i)))}
function armTurn(room){
  if(room.turnTimer)clearTimeout(room.turnTimer);room.turnTimer=null;
  const g=room.game;if(!g||g.finished||g.phase!=='choose')return;
  room.deadline=Date.now()+TURN_MS;broadcastState(room);
  room.turnTimer=setTimeout(()=>{
    if(!room.game||room.game.finished||room.game.phase!=='choose')return;
    const seat=room.game.active,card=room.game.decks[seat][0],banned=room.game.mode===MODES.tactical?room.game.lastAttribute:null;
    const attribute=chooseCpuAttribute(card,cards,banned);performAction(room,seat,attribute,true)
  },TURN_MS+25)
}
function sendGameOver(room){
  const g=room.game,out=g.outcome;room.finished=true;room.deadline=null;
  peers(room).forEach((p,i)=>send(p,'gameover',{winner:out.winner===null?'draw':out.winner===i?'you':'them',counts:[out.counts[i],out.counts[1-i]],mode:g.mode,roundsPlayed:out.roundsPlayed}));
  scheduleGc(room,FINISHED_TTL)
}
function performAction(room,seat,attribute,timedOut=false){
  const g=room?.game;if(!g||room.finished||g.finished||g.phase!=='choose')return false;
  if(seat!==g.active||!legalAttributes(g).includes(attribute))return false;
  if(room.turnTimer)clearTimeout(room.turnTimer);room.turnTimer=null;room.deadline=null;
  let result;try{result=resolveRound(g,attribute,seat)}catch{return false}
  peers(room).forEach((p,i)=>send(p,'reveal',{
    countsBefore:i===0?result.countsBefore:[result.countsBefore[1],result.countsBefore[0]],capturedCount:result.capturedCount,capturedCards:result.capturedCards,
    cards:i===0?result.cards:[result.cards[1],result.cards[0]],values:i===0?result.values:[result.values[1],result.values[0]],attribute,
    winner:result.winner===null?null:(result.winner===i?'you':'them'),pot:g.pot.length*2,timedOut:timedOut&&seat===i,
    counts:[g.decks[i].length,g.decks[1-i].length],round:g.round,maxRounds:g.maxRounds,mode:g.mode
  }));
  room.revealTimer=setTimeout(()=>{
    room.revealTimer=null;advanceMatch(g);if(g.finished)sendGameOver(room);else armTurn(room)
  },REVEAL_MS);
  return true
}

wss.on('connection',ws=>{
  ws.room=null;ws.seat=null;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return send(ws,'error',{message:'Invalid message'})}
    if(m.type==='create'){
      if(ws.room)return send(ws,'error',{message:'Leave the current room before creating another.'});
      let c;do c=roomCode();while(rooms.has(c));
      const mode=m.mode===MODES.tactical?MODES.tactical:MODES.classic,room={code:c,mode,players:[ws],game:null,finished:false,createdAt:Date.now(),deadline:null};
      rooms.set(c,room);ws.room=c;ws.seat=0;send(ws,'room',{code:c,seat:0,mode});scheduleGc(room,WAITING_TTL);return
    }
    if(m.type==='join'){
      if(ws.room)return send(ws,'error',{message:'You are already in a room.'});
      const c=String(m.code||'').trim().toUpperCase(),room=rooms.get(c);
      if(!room||room.finished||room.players.length!==1)return send(ws,'error',{message:'Room unavailable'});
      if(room.players.includes(ws))return send(ws,'error',{message:'You cannot join your own room.'});
      if(room.gcTimer)clearTimeout(room.gcTimer);room.gcTimer=null;room.players.push(ws);ws.room=c;ws.seat=1;
      room.game=createMatch(cards,{deckSize:6,maxRounds:24,mode:room.mode,starter:randomInt(2)});
      peers(room).forEach((p,i)=>send(p,'ready',{code:c,seat:i,mode:room.mode}));armTurn(room);return
    }
    const room=rooms.get(ws.room);
    if(!room||room.finished)return send(ws,'error',{message:'This room is no longer active.'});
    if(m.type==='action'){
      if(!performAction(room,ws.seat,m.action,false))send(ws,'error',{message:'That action is not legal right now.'});return
    }
    if(m.type==='swap'){
      const g=room.game;if(!g||g.finished||g.phase!=='choose'||g.active!==ws.seat)return send(ws,'error',{message:'Reserve swap is not available now.'});
      try{reserveSwap(g,ws.seat);broadcastState(room)}catch(e){send(ws,'error',{message:e.message})}return
    }
  });
  ws.on('close',()=>{
    const code=ws.room,room=rooms.get(code);if(!room)return;
    if(room.players.length>1)destroyRoom(code,'Opponent disconnected. Room closed.');else destroyRoom(code)
  });
});

server.listen(process.env.PORT||3000,()=>console.log(`CHIMPIONS Arena on http://localhost:${process.env.PORT||3000}`));
