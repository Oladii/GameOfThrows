import { DEFAULT_CONFIG } from './rules.js';
import { renderTokenBody } from './token-presentation.js';
import { clone, analyze } from './engine.js';
import { UNIT_BATTLE_SCENES, createUnitBattle, renderShowcaseBattle } from './onboarding-showcase.js';
const unitPiece=(id,type,team,q,r)=>({id,type,team,q,r});

export function badgeExamples(){
  const config=clone(DEFAULT_CONFIG);config.size=3;
  return [
    {label:'Без угрозы',enemies:[],showIncoming:false,explanation:'Угрозы нет'},
    {label:'Под огнём',enemies:[unitPiece('enemy','archer',1,0,2)],showIncoming:false,explanation:'В конце хода выживет, так как входящий урон меньше его стойкости'},
    {label:'Входящий урон',enemies:[unitPiece('enemy','archer',1,0,2)],showIncoming:true,explanation:'Число сверху показывает суммарный урон от врагов'},
    {label:'Смертельный урон',enemies:[unitPiece('enemy','archer',1,0,2),unitPiece('second','shield',1,1,0)],showIncoming:true,explanation:'Фигура погибает в конце хода, если полученный урон равен стойкости или превышает её'}
  ].map(example=>({...example,info:analyze({pieces:[unitPiece('blue','shield',0,0,0),...example.enemies],turn:0,ply:0,winner:null},config).get('blue')}));
}

export function renderUnitExamples(battles={},icons={},renderBadges=()=>''){
  const badges=`<section class="badge-guide" aria-labelledby="badge-guide-title"><div class="lesson-scene-heading"><h4 id="badge-guide-title">Значения на бейджах</h4><p><strong>Слева — урон:</strong> сколько урона наносит фигура<br><strong>Справа — полная стойкость:</strong> с усилениями союзников, без вычитания урона<br><strong>Сверху — под угрозой:</strong> при выборе и наведении показан входящий урон; смертельная угроза отмечается черепом</p></div><div class="lesson-scene"><div class="badge-examples">${badgeExamples().map(example=>`<figure><svg viewBox="-38 -32 76 70" role="img" aria-label="${example.label}: ${example.explanation}"><g class="lesson-piece lesson-friendly${example.info.dead?' lesson-fatal':''}">${renderTokenBody({type:'shield',icon:icons.shield,veteran:false},1)}${renderBadges(example.info,{showIncoming:example.showIncoming})}</g></svg><figcaption><strong>${example.label}</strong><span>${example.explanation}</span></figcaption></figure>`).join('')}</div></div></section>`;
  return '<div class="lesson-page">'+badges+UNIT_BATTLE_SCENES.map(key=>renderShowcaseBattle(battles[key]||createUnitBattle(key),icons,renderBadges)).join('')+'</div>';
}
