import test from 'node:test';
import assert from 'node:assert/strict';
// Fixed revision-12 combat fixture for arrow placement.
import { PREVIOUS_SUPPORT_CONFIG as DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze } from '../dist/engine.js';
import { lethalAttackPresentation, layoutDamageArrows, renderDamageArrows, MAX_DAMAGE_ARROW_BEND } from '../dist/board-presentation.js';

const point=p=>({x:p.q,y:p.r});
const piece=(id,q,r)=>({id,q,r});
const arrow=(source,target,damage=20)=>({source,target,damage});
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
function checkDistinct(edges) {
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++)assert.equal(overlap(edges[i].label,edges[j].label),false,`${edges[i].source.id}:${edges[i].target.id} overlaps ${edges[j].source.id}:${edges[j].target.id}`);
}
function checkLocal(edges) {
  for (const edge of edges) {
    const {from,to,control,label,labelT:t}=edge,dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
    for(let i=0;i<=100;i++) {
      const u=i/100,x=(1-u)**2*from.x+2*(1-u)*u*control.x+u*u*to.x,y=(1-u)**2*from.y+2*(1-u)*u*control.y+u*u*to.y;
      assert.ok(Math.abs(dx*(y-from.y)-dy*(x-from.x))/length<=MAX_DAMAGE_ARROW_BEND+1e-8,'the entire curve stays near the direct attack');
    }
    assert.ok(Math.hypot((1-t)**2*from.x+2*(1-t)*t*control.x+t*t*to.x-label.x,
      (1-t)**2*from.y+2*(1-t)*t*control.y+t*t*to.y-label.y)<1e-8,'the badge stays on its curve');
  }
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

test('an overcrowded six-way fight stays local and inside the field instead of routing labels across it',()=>{
  const target=piece('target',0,0),sources=Array.from({length:6},(_,i)=>piece(`s${i}`,Math.cos(i*Math.PI/3)*57,Math.sin(i*Math.PI/3)*57));
  const arrows=sources.flatMap((source,i)=>[arrow(source,target,18+i),arrow(target,source,100+i)]);
  const pieces=[target,...sources,piece('uninvolved',0,-114)],bounds={left:-210,right:210,top:-210,bottom:210};
  const edges=layoutDamageArrows(arrows,point,{pieces,bounds});checkLocal(edges);
  assert.equal(edges.length,arrows.length,'crowding must not silently discard an attack');
  for(const {label} of edges) {
    assert.ok(label.left>=bounds.left&&label.right<=bounds.right&&label.top>=bounds.top&&label.bottom<=bounds.bottom);
  }
});

test('three adjacent casualties keep only six sufficient attacks with distinct local labels',()=>{
  const entries=[['n','shield',0,0,0],['s1','shield',1,-1,1],['s2','shield',1,0,1],['n1','shield',0,1,-1],['n2','shield',0,2,-1],
    ['a1','archer',0,-1,-2],['a2','archer',0,0,-2],['a3','archer',0,2,-2],['a4','archer',0,3,-2],['b1','archer',1,-3,3],['b2','archer',1,0,3]];
  const pieces=entries.map(([id,type,team,q,r])=>({id,type,team,q,r})),position={pieces,turn:0,ply:0,winner:null};
  const report=analyze(position,DEFAULT_CONFIG),deaths=pieces.filter(p=>report.get(p.id).dead);
  assert.deepEqual(deaths.map(p=>p.id),['n','s1','s2']);
  assert.equal(deaths.reduce((sum,p)=>sum+report.get(p.id).attackers.length,0),10);
  const view=lethalAttackPresentation(position,report,deaths);
  assert.equal(view.arrows.length,6);
  for(const target of deaths) {
    const damage=view.arrows.filter(a=>a.target.id===target.id).map(a=>a.damage);
    const sum=damage.reduce((a,b)=>a+b,0),fortitude=report.get(target.id).fortitude;
    assert.ok(sum>=fortitude&&sum-damage.at(-1)<fortitude);
  }
  const point=p=>({x:Math.sqrt(3)*33*(p.q+p.r/2),y:49.5*p.r}),edges=layoutDamageArrows(view.arrows,point,{pieces});
  checkLocal(edges);checkDistinct(edges);
  for(const {label,source,target} of edges)for(const p of pieces.filter(p=>p.id!==source.id&&p.id!==target.id)) {
    const c=point(p);assert.equal(overlap(label,{left:c.x-32,right:c.x+32,top:c.y-30,bottom:c.y+24}),false,`${source.id}:${target.id} covers ${p.id}`);
  }
});

test('blocked local positions have a finite bounded fallback, with and without field bounds',()=>{
  const a=piece('a',-57,0),b=piece('b',57,0);
  const pieces=Array.from({length:25},(_,i)=>piece(`blocker${i}`,(i%5-2)*30,(Math.floor(i/5)-2)*25));
  for(const bounds of [null,{left:-90,right:90,top:-70,bottom:70}]) {
    const edges=layoutDamageArrows([arrow(a,b),arrow(b,a)],point,{pieces,bounds});
    assert.equal(edges.length,2);checkLocal(edges);checkDistinct(edges);
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
