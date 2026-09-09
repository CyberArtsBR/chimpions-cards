import http from 'node:http'; import {readFile,stat} from 'node:fs/promises'; import {extname,join,normalize} from 'node:path'; import {WebSocketServer} from 'ws'; import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://x');let p=normalize(url.pathname).replace(/^(\.\.(\/|\\|$))+/, '');if(p==='/' )p='/index.html';let f=join(root,p);if(!(await stat(f)).isFile()) throw 0;res.writeHead(200,{'content-type':mime[extname(f)]||'application/octet-stream','cache-control':extname(f)==='.html'?'no-cache':'public,max-age=3600'});res.end(await readFile(f));}catch{res.writeHead(404);res.end('Not found');}});
const wss=new WebSocketServer({server,path:'/room'}),rooms=new Map();
const code=()=>Array.from({length:4},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random()*24|0]).join('');
function send(ws,type,data={}){if(ws.readyState===1)ws.send(JSON.stringify({type,...data}))} function peers(r){return r?.players||[]}
wss.on('connection',ws=>{ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return} if(m.type==='create'){let c;do c=code();while(rooms.has(c));rooms.set(c,{players:[ws]});ws.room=c;send(ws,'room',{code:c,seat:0});}
else if(m.type==='join'){const c=String(m.code||'').toUpperCase(),r=rooms.get(c);if(!r||r.players.length>1)return send(ws,'error',{message:'Room unavailable'});r.players.push(ws);ws.room=c;peers(r).forEach((p,i)=>send(p,'ready',{code:c,seat:i}));}
else if(m.type==='action'){const r=rooms.get(ws.room);if(!r)return;const seat=r.players.indexOf(ws);r.players.forEach((p,i)=>i!==seat&&send(p,'action',{action:m.action,from:seat}));}});ws.on('close',()=>{const r=rooms.get(ws.room);if(!r)return;r.players.forEach(p=>p!==ws&&send(p,'left'));rooms.delete(ws.room);});});
server.listen(process.env.PORT||3000,()=>console.log(`CHIMPIONS Arena on http://localhost:${process.env.PORT||3000}`));
