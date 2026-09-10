import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd();
const tutorials={
  tactical:['TACTICAL','CHOOSE 1 STAT','1 RESERVE SWAP'],
  'ban-counter':['BAN &amp; COUNTER','DEFENDER BANS 1 STAT','WINNER CAPTURES BOTH'],
  triple:['TRIPLE CLASH','CHOOSE 3 ATTRIBUTES','WIN 2 OUT OF 3'],
  'team-tag':['TEAM TAG 2v2','20 CARDS EACH','SPLIT TOP 2 = DRAW']
};

for(const [name,phrases] of Object.entries(tutorials)){
  const file=path.join(root,'public','tutorials',`${name}.svg`);
  const svg=fs.readFileSync(file,'utf8');
  assert.ok(Buffer.byteLength(svg)>=5_000,`${name}.svg is unexpectedly small; tutorial may be incomplete`);
  assert.match(svg,/^<svg[^>]+viewBox="0 0 1254 1254"/i,`${name}.svg must keep the 1254×1254 vector canvas`);
  assert.match(svg,/<title\b/i,`${name}.svg needs an accessible title`);
  assert.doesNotMatch(svg,/<image\b[^>]+(?:\.webp|\.png|\.jpe?g)/i,`${name}.svg must be self-contained and not depend on a raster tutorial`);
  for(const phrase of phrases)assert.ok(svg.includes(phrase),`${name}.svg is missing tutorial copy: ${phrase}`);
  console.log(`✓ ${name}: scalable 1254×1254 SVG, ${(Buffer.byteLength(svg)/1024).toFixed(1)} KiB`);
}

const back=fs.readFileSync(path.join(root,'public','ui','opponent-card-back.svg'),'utf8');
assert.match(back,/viewBox="0 0 1000 1470"/,'opponent card back must use the premium 1000×1470 vector canvas');
assert.match(back,/OPPONENT CARD/i,'opponent card back label missing');
assert.match(back,/REVEALED AFTER LOCK-IN/i,'opponent card back lock-in copy missing');
assert.doesNotMatch(back,/<image\b/i,'opponent card back should remain resolution-independent vector art');

const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
assert.match(html,/aaa-polish\.css/,'AAA polish stylesheet is not loaded');
assert.match(html,/aaa-enhancements\.js/,'AAA enhancement script is not loaded');
assert.match(html,/tutorial-source-fix\.js/,'tutorial source hardening layer is not loaded');
for(const name of Object.keys(tutorials))assert.match(html,new RegExp(`tutorials/${name}\\.svg`),`${name} tutorial is not preloaded`);

const sourceFix=fs.readFileSync(path.join(root,'public','tutorial-source-fix.js'),'utf8');
for(const name of Object.keys(tutorials)){
  assert.ok(sourceFix.includes(`/tutorials/${name}.webp`),`${name} legacy tutorial mapping missing`);
  assert.ok(sourceFix.includes(`/tutorials/${name}.svg`),`${name} vector tutorial mapping missing`);
}

const css=fs.readFileSync(path.join(root,'public','aaa-polish.css'),'utf8');
for(const selector of ['team-stat-linked','team-link-rail','round-card-result','round-draw-result','tutorial-frame']){
  assert.ok(css.includes(selector),`AAA polish is missing ${selector} styling`);
}

console.log('UI asset validation passed: vector tutorials, premium opponent back, Team Tag linking, results feedback, and AAA layers are wired.');
