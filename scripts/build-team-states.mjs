import fs from 'node:fs/promises';
import vm from 'node:vm';
import { DEFAULT_CONFIG, TYPES, LABELS } from '../dist/rules.js';
import { createGame, winnerForPieces } from '../dist/engine.js';
import { HORN_ICON_PATH, COMMANDER_ICON_PATH } from '../dist/token-presentation.js';
const root = new URL('../', import.meta.url);
const app = await fs.readFile(new URL('dist/app.js', root), 'utf8');
const extract = (a,b) => app.slice(app.indexOf(a), app.indexOf(b,app.indexOf(a)));
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let css = await fs.readFile(new URL('dist/styles.css',root),'utf8');
for(const color of ['red','blue']) css=css.replaceAll(`./brand/team-${color}.png`,'data:image/png;base64,'+(await fs.readFile(new URL(`dist/brand/team-${color}.png`,root))).toString('base64'));
const cases=[];
function add(group,label,patch={},positionPatch={},roomPatch={}) {
  const nodes = Object.fromEntries(['#scoreboard','#move-counter','#mode-caption','.arena-top'].map(k=>[k,{innerHTML:'',textContent:'',dataset:{}}]));
  const position={...createGame(DEFAULT_CONFIG),ply:3,turn:1,...positionPatch};
  const snapshot={phase:'playing',seats:[{guestId:'blue'},{guestId:'red'}],participants:[{guestId:'blue',present:true},{guestId:'red',present:true}],...roomPatch};
  const ctx=vm.createContext({gamePhase:'playing',editor:false,playMode:'bot',humanTeam:1,botDifficulty:'normal',config:{...DEFAULT_CONFIG},movement:null,combat:null,currentDeaths:[],reviewingTurn:false,roomMovePreview:null,roomConnecting:false,
    roomView:{selfSeat:1,status:'connected',pending:false,snapshot},BOT_DIFFICULTIES:{training:{label:'Неопытный'},normal:{label:'Опытный'},hard:{label:'Воевода'}},TEAM_NAMES:['Синие','Красные'],TYPES,LABELS,HORN_ICON_PATH,COMMANDER_ICON_PATH,
    plural:(n,f)=>n%100>=11&&n%100<=14?f[2]:n%10===1?f[0]:n%10>=2&&n%10<=4?f[1]:f[2],$:s=>nodes[s],...patch});
  if(patch.roomView) ctx.roomView={selfSeat:1,status:'connected',pending:false,snapshot,...patch.roomView};
  vm.runInContext(extract('const ICON_PATHS =','const unitBadges =')+extract('function matchResult(','function renderUpdateNotice(')+extract('function renderScoreboard(','function renderFirstMoveNotice('),ctx);
  ctx.renderGameResult(position);ctx.renderScoreboard(position);
  cases.push({group,label,line:nodes['#move-counter'].textContent,html:nodes['#scoreboard'].innerHTML});
}
function result(group,label,patch,winner,condition='flag-or-combat',loss=['defenseLamp','horn']) {
  const winnerArmy=['defenseLamp','shield'];
  const teams=winner==='draw'?[loss,loss]:[0,1].map(t=>t===winner?winnerArmy:loss);
  const pieces=teams.flatMap((types,team)=>types.map((type,id)=>({id:`${team}-${id}`,team,type})));
  const actual=winnerForPieces(pieces,{victoryCondition:condition});
  if(actual!==winner)throw new Error('Invalid gallery outcome: '+label);
  add(group,label,{...patch,config:{...DEFAULT_CONFIG,victoryCondition:condition}},{winner,ply:20,pieces});
}
for(const humanTeam of [1,0]) {
  for(const botDifficulty of ['training','normal','hard']) add('bot',`Вы за ${humanTeam?'Красных':'Синих'} · ${botDifficulty==='normal'?'опытный бот':botDifficulty==='hard'?'воевода':'неопытный бот'}`,{humanTeam,botDifficulty},{turn:humanTeam});
  add('bot',`Вы за ${humanTeam?'Красных':'Синих'} · ход бота`,{humanTeam},{turn:1-humanTeam,ply:4});
  result('bot',`Вы за ${humanTeam?'Красных':'Синих'} · победа`,{humanTeam},humanTeam);
  result('bot',`Вы за ${humanTeam?'Красных':'Синих'} · поражение`,{humanTeam},1-humanTeam);
}
result('bot','Поражение обеих сторон',{},'draw');
add('bot','Подготовка',{gamePhase:'setup'});
add('bot','Перемещение',{movement:{}});
add('bot','Расчёт боя',{combat:{}});
add('bot','Просмотр прошлого хода',{reviewingTurn:true});
for(const turn of [1,0]) add('local',`Ход ${turn?'Красных':'Синих'}`,{playMode:'local'},{turn});
add('local','Расстановка перед игрой',{playMode:'local',gamePhase:'setup'});
for(const winner of [1,0])result('local',`Победили ${winner?'Красные':'Синие'}`,{playMode:'local'},winner);
result('local','Поражение обеих сторон',{playMode:'local'},'draw');
add('local','Расчёт боя',{playMode:'local',combat:{}});
add('local','Просмотр прошлого хода',{playMode:'local',reviewingTurn:true});
const waiting={phase:'waiting',seats:[null,null],participants:[]};
add('online','Оба места свободны',{playMode:'online',gamePhase:'setup',roomView:{selfSeat:null}},{},waiting);
add('online','Подключение · выбор стороны недоступен',{playMode:'online',gamePhase:'setup',roomConnecting:true,roomView:{selfSeat:null,status:'connecting'}},{},waiting);
for(const selfSeat of [1,0]) {
  const seats=[null,null];seats[selfSeat]={guestId:selfSeat?'red':'blue'};
  add('online',`Вы выбрали ${selfSeat?'Красных':'Синих'} · ждём второго игрока`,{playMode:'online',gamePhase:'setup',roomView:{selfSeat}},{},{phase:'waiting',seats});
  add('online',`Вы за ${selfSeat?'Красных':'Синих'} · запрос выполняется`,{playMode:'online',gamePhase:'setup',roomView:{selfSeat,pending:true}},{},{phase:'waiting',seats});
  for(const turn of [selfSeat,1-selfSeat])add('online',`Вы за ${selfSeat?'Красных':'Синих'} · ${turn===selfSeat?'ваш ход':'ход соперника'}`,{playMode:'online',roomView:{selfSeat}},{turn});
  add('online',`Вы за ${selfSeat?'Красных':'Синих'} · потеряна ваша связь`,{playMode:'online',roomView:{selfSeat,status:'reconnecting'}});
  add('online',`Вы за ${selfSeat?'Красных':'Синих'} · соперник не в сети`,{playMode:'online',roomView:{selfSeat}},{},{participants:[{guestId:selfSeat?'red':'blue',present:true}]});
  result('online',`Вы за ${selfSeat?'Красных':'Синих'} · победа`,{playMode:'online',roomView:{selfSeat}},selfSeat);
  result('online',`Вы за ${selfSeat?'Красных':'Синих'} · поражение`,{playMode:'online',roomView:{selfSeat}},1-selfSeat);
}
add('online','Зритель · одно место занято',{playMode:'online',gamePhase:'setup',roomView:{selfSeat:null}},{},{phase:'waiting',seats:[{guestId:'blue'},null]});
for(const turn of [1,0])add('online',`Зритель · ход ${turn?'Красных':'Синих'}`,{playMode:'online',roomView:{selfSeat:null}},{turn});
for(const winner of [1,0])result('online',`Зритель · победили ${winner?'Красные':'Синие'}`,{playMode:'online',roomView:{selfSeat:null}},winner);
result('online','Поражение обеих сторон · игрок',{playMode:'online',roomView:{selfSeat:1}},'draw');
result('online','Поражение обеих сторон · зритель',{playMode:'online',roomView:{selfSeat:null}},'draw');
add('online','Комната закрыта · выбор недоступен',{playMode:'online',gamePhase:'setup',roomView:{selfSeat:1,status:'closed'}},{},{phase:'waiting',seats:[null,{guestId:'red'}]});
for(const winner of [1,0])for(const [label,condition,loss]of [['Уничтожено знамя','flag-or-combat',['archer']],['Уничтожены боевые фигуры','flag-or-combat',['defenseLamp','horn']],['Уничтожены все фигуры','all-units',[]]])result('reasons',`${winner?'Красные':'Синие'} · ${label}`,{playMode:'local'},winner,condition,loss);
for(const [label,loss]of [['Оба знамени уничтожены',['archer']],['Боевые фигуры обеих сторон уничтожены',['defenseLamp','horn']]])result('reasons','Поражение обеих сторон · '+label,{playMode:'local'},'draw','flag-or-combat',loss);
result('reasons','Поражение обеих сторон · все фигуры уничтожены',{playMode:'local'},'draw','all-units',[]);
const losses=[['Знамя',['archer']],['Боевые фигуры',['defenseLamp','horn']]];
for(const [a,north] of losses) for(const [b,south] of losses) if(a!==b){
  const mixed=[north,south].flatMap((types,team)=>types.map(type=>({team,type})));
  add('reasons',`Поражение обеих сторон · Синие: ${a}; Красные: ${b}`,{playMode:'local'},{winner:winnerForPieces(mixed,DEFAULT_CONFIG),pieces:mixed,ply:20});
}
const groups={bot:'Игра с ботом',local:'На одном компьютере',online:'По сети',reasons:'Причины окончания партии'};
const content=Object.entries(groups).map(([key,title])=>`<section class="state-group" id="${key}"><h2>${title}</h2>${cases.filter(c=>c.group===key).map(c=>`<article class="state-example"><h3>${escape(c.label)}</h3><div class="state-turn">${escape(c.line)}</div><div class="state-surface"><div class="scoreboard">${c.html}</div></div></article>`).join('')}</section>`).join('');
const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Плашки команд — все состояния</title><style>${css}
body{margin:0;background:var(--bg)}.state-gallery{max-width:1200px;margin:auto;padding:28px 24px}.state-gallery h1{font-size:26px;margin:0 0 8px}.state-gallery>p{font-size:13px}.state-nav{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0 28px}.state-nav a{background:#f3ecde;border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-size:13px}.state-group{scroll-margin-top:20px;margin:36px 0}.state-group>h2{font-size:22px}.state-example{margin:22px 0 28px}.state-example h3{font-size:13px;font-weight:500;margin:0 0 10px;color:var(--muted)}.state-turn{text-align:center;color:#66502c;font-size:13px;font-weight:600;margin-bottom:12px}.state-surface{padding:14px;border:1px solid var(--panel-border);border-radius:23px;background:var(--surface)}.state-gallery .scoreboard{margin:0;flex-direction:row}.state-gallery .team-card{flex:1}.state-gallery .team-card.match-result{flex-basis:100%}.state-gallery .lesson-details{max-width:410px}.state-gallery .button{cursor:default}@media(max-width:900px){.state-gallery .scoreboard{flex-direction:column}.state-gallery{padding:20px 14px}}.state-note{color:var(--muted)}
</style><main class="state-gallery"><h1>Плашки команд и результата</h1><p>Состояний: ${cases.length} · реальные компоненты игры · высота 72 px · промежуток между строками 8 px</p><nav class="state-nav">${Object.entries(groups).map(([key,title])=>`<a href="#${key}">${title}</a>`).join('')}<a href="#training">Кнопки обучения</a></nav><p class="state-note">Примеры для сравнения. Кнопки выбора стороны здесь не подключены к игровой комнате. На узком экране высота растёт, если текст переносится.</p>${content}<section id="training"><h2>Кнопки обучения</h2><div class="lesson-details"><div class="unit-demo-controls"><button class="button primary">Сыграть ещё раз</button></div><div class="unit-demo-controls"><button class="button primary">Дальше</button></div><div class="unit-demo-controls"><button class="button outline">Вернуть исходную позицию</button></div></div></section></main></html>`;
await fs.writeFile(new URL('dist/team-states.html',root),html);
await fs.mkdir(new URL('../../../outputs/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('../../../outputs/team-states.html',import.meta.url),html);
console.log(`Team states: ${cases.length}`);
