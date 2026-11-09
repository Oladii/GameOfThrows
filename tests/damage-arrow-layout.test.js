import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutDamageArrows, renderDamageArrows } from '../dist/board-presentation.js';

const point=p=>({x:p.q,y:p.r});
const piece=(id,q,r)=>({id,q,r});
const arrow=(source,target,damage=20)=>({source,target,damage});
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
function checkDistinct(edges) {
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++)assert.equal(overlap(edges[i].label,edges[j].label),false,`${edges[i].source.id}:${edges[i].target.id} overlaps ${edges[j].source.id}:${edges[j].target.id}`);
}

test('crossing rays and combined attacks have separate labels, with enough width for all digits',()=>{
  const left=piece('left',-114,0),right=piece('right',114,0),top=piece('top',-57,-99),bottom=piece('bottom',57,99),target=piece('target',0,0);
  const arrows=[arrow(left,right,120),arrow(top,bottom,88),arrow(right,left,9999),arrow(bottom,top),arrow(left,target,24),arrow(top,target,16)];
  const edges=layoutDamageArrows(arrows,point);
  assert.equal(edges.length,arrows.length);checkDistinct(edges);
  assert.ok(edges.find(e=>e.damage===9999).label.width>edges.find(e=>e.damage===16).label.width);
  const html=renderDamageArrows(arrows,point);
  assert.equal((html.match(/class="attack-ray"/g)||[]).length,arrows.length);
  assert.equal((html.match(/class="attack-ray-label"/g)||[]).length,arrows.length);
  assert.ok(html.lastIndexOf('class="attack-ray"')<html.indexOf('class="attack-ray-label"'),'all numbers are above all arrow shafts');
  assert.ok(!html.includes('leader'));
  for(const e of edges){const t=e.labelT,p={x:(1-t)**2*e.from.x+2*(1-t)*t*e.control.x+t*t*e.to.x,y:(1-t)**2*e.from.y+2*(1-t)*t*e.control.y+t*t*e.to.y};assert.ok(Math.hypot(p.x-e.label.x,p.y-e.label.y)<1e-8,'the number must lie on its arrow');}
});

test('overlapping collinear rays occupy different lanes, including reciprocal attacks',()=>{
  const a=piece('a',0,0),b=piece('b',171,0),c=piece('c',57,0),d=piece('d',114,0);
  const edges=layoutDamageArrows([arrow(a,b),arrow(c,b),arrow(a,d),arrow(b,a)],point);
  assert.equal(new Set(edges.map(e=>e.control.y)).size,edges.length);checkDistinct(edges);
});

test('a dense six-way fight keeps labels off pieces and inside the available field',()=>{
  const target=piece('target',0,0),sources=Array.from({length:6},(_,i)=>piece(`s${i}`,Math.cos(i*Math.PI/3)*57,Math.sin(i*Math.PI/3)*57));
  const arrows=sources.flatMap((source,i)=>[arrow(source,target,18+i),arrow(target,source,100+i)]);
  const pieces=[target,...sources,piece('uninvolved',0,-114)],bounds={left:-210,right:210,top:-210,bottom:210};
  const edges=layoutDamageArrows(arrows,point,{pieces,bounds});checkDistinct(edges);
  for(const {label,source,target} of edges) {
    assert.ok(label.left>=bounds.left&&label.right<=bounds.right&&label.top>=bounds.top&&label.bottom<=bounds.bottom);
    for(const p of pieces.filter(p=>p.id!==source.id&&p.id!==target.id))assert.equal(overlap(label,{left:p.q-32,right:p.q+32,top:p.r-30,bottom:p.r+24}),false);
  }
});

test('hover redraws and input ordering preserve label positions, and zero-length rays are ignored',()=>{
  const a=piece('a',-57,0),b=piece('b',57,0),c=piece('c',0,-99),d=piece('d',0,99);
  const arrows=[arrow(a,b),arrow(c,d),arrow(b,a)];
  const positions=items=>layoutDamageArrows(items,point).map(e=>({source:e.source.id,target:e.target.id,label:e.label,from:e.from,to:e.to,control:e.control}));
  assert.deepEqual(positions(arrows),positions([...arrows].reverse()));
  assert.deepEqual(positions(arrows),positions(arrows));
  assert.equal(layoutDamageArrows([arrow(a,a)],point).length,0);
});
