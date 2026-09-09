import test from 'node:test';import assert from 'node:assert/strict';
function settle(a,b,pot=[]){if(a===b)return {pot:[...pot,'a','b'],winner:null};return {pot:[],winner:a>b?'a':'b',loot:pot.length+2}}
test('tie preserves every card in standoff pot',()=>assert.deepEqual(settle(50,50,['x','y']).pot,['x','y','a','b']));
test('decisive round awards current cards and whole pot',()=>assert.deepEqual(settle(60,50,['x','y']),{pot:[],winner:'a',loot:4}));
