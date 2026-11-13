import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, cells, validateState, move, inspectCell } from '../dist/engine.js';
import { renderUnitBadges } from '../dist/board-presentation.js';
import { ShowcaseBattle, createShowcaseBattle, renderShowcaseBattle, showcasePoint, TRAINING_ACTIONS } from '../dist/onboarding-showcase.js';

function lesson() {
  let id = 0; const pending = new Map();
  const clock = { setTimer: callback => { pending.set(++id, callback); return id; }, clearTimer: handle => pending.delete(handle) };
  const battle = new ShowcaseBattle({ clock, reducedMotion: () => true });
  const settle = () => {
    let remaining = 50;
    while (battle.presentation && remaining-- > 0) {
      const [handle, callback] = [...pending][0]; pending.delete(handle); callback();
    }
    assert.equal(battle.presentation, null);
  };
  const reply = () => { const [handle, callback] = [...pending][0]; pending.delete(handle); callback(); settle(); };
  const play = () => { const action = TRAINING_ACTIONS[battle.position.ply]; battle.selectPiece(action.id); const accepted = battle.moveTo(action.to); if (accepted) settle(); return accepted; };
  return { battle, pending, play, reply, settle };
}

const damageEdges = html => [...html.matchAll(/class="attack-ray" data-source="([^"]+)" data-target="([^"]+)"/g)].map(match => `${match[1]}:${match[2]}`).sort();
const incomingEdges = (report, piece) => report.get(piece.id).attackers.map(attack => `${attack.id}:${piece.id}`).sort();

test('the lesson retains the 37-cell board with two shields, two archers and a central flag per side', () => {
  const { position, config } = createShowcaseBattle();
  assert.equal(config.size,3); assert.equal(cells(config).length,37);
  assert.deepEqual(config.stats,DEFAULT_CONFIG.stats); assert.deepEqual(validateState(position,config),position);
  for (const team of [0,1]) {
    const pieces = position.pieces.filter(piece=>piece.team===team);
    assert.equal(pieces.length,5);
    for (const type of ['attackLamp','scoutLamp','horn']) assert.equal(pieces.filter(piece=>piece.type===type).length,0);
    for (const type of ['shield','archer','defenseLamp']) assert.equal(pieces.filter(piece=>piece.type===type).length,['shield','archer'].includes(type)?2:1);
    const flag = showcasePoint(pieces.find(piece=>piece.type==='defenseLamp'));
    const bows = pieces.filter(piece=>piece.type==='archer').map(showcasePoint).sort((a,b)=>a.x-b.x);
    assert.equal(flag.x,(bows[0].x+bows[1].x)/2); assert.equal(flag.y,bows[0].y);
  }
  assert.ok([...analyze(position,config).values()].every(info=>!info.dead)); assert.equal(position.turn,1);
  const origin = showcasePoint({q:0,r:0}), neighbour = showcasePoint({q:1,r:0});
  assert.ok(Math.abs(neighbour.x-origin.x-Math.sqrt(3)*33) < 1e-8);
  const html = renderShowcaseBattle(createShowcaseBattle());
  const polygon = html.match(/class="tile" points="([^"]+)"/)[1].split(' ').map(point => point.split(',').map(Number));
  const tileWidth = Math.max(...polygon.map(point=>point[0]))-Math.min(...polygon.map(point=>point[0]));
  assert.ok(Math.abs(tileWidth-Math.sqrt(3)*32) < 1e-8);
  assert.ok(neighbour.x-origin.x > tileWidth, 'neighbouring tiles keep the same gap as the normal field');
});

test('the approved three plies match every explained damage total and win by capturing the flag', () => {
  let { position, config } = createShowcaseBattle();
  const expected = [
    [['n-shield-right',7,7]],
    [['n-shield-left',14,6],['s-shield-right',7,6],['s-shield-left',5,6]],
    [['n-flag',5,3],['s-shield-left',2,6]]
  ];
  for (const [i,action] of TRAINING_ACTIONS.entries()) {
    const forecast = inspectCell(position,config,action.to,action.id);
    assert.equal(forecast.isPreview,true);
    for (const [id,incoming,fortitude] of expected[i]) {
      assert.equal(forecast.report.get(id).incoming,incoming,id); assert.equal(forecast.report.get(id).fortitude,fortitude,id);
    }
    if (i===0) assert.deepEqual(forecast.report.get('n-shield-right').attackers.map(a=>a.damage).sort(),[2,5]);
    position = move(position,config,action.id,action.to).state;
  }
  assert.equal(position.winner,1); assert.equal(position.ply,3);
  assert.ok(position.pieces.some(piece=>piece.id==='s-flag')); assert.ok(!position.pieces.some(piece=>piece.id==='n-flag'));
});

test('only the recommended piece and cell can advance, with exactly one scripted reply', () => {
  const { battle, pending, play, reply, settle } = lesson(), other = createShowcaseBattle();
  const initial=structuredClone(battle.position);
  assert.equal(battle.moveTo(TRAINING_ACTIONS[0].to),false);
  battle.selectPiece('s-shield-right'); assert.equal(battle.moveTo(TRAINING_ACTIONS[0].to),false);
  battle.selectPiece('s-shield-left'); assert.equal(battle.moveTo({q:-2,r:1}),false);
  battle.preview(TRAINING_ACTIONS[0].to); assert.deepEqual(battle.previewCell,TRAINING_ACTIONS[0].to);
  assert.deepEqual(battle.position,initial); assert.deepEqual(other.position,initial);
  assert.equal(battle.moveTo(TRAINING_ACTIONS[0].to),true); settle(); assert.equal(battle.position.ply,1);
  assert.equal(battle.phase,'reply-preview'); assert.equal(pending.size,1);
  battle.selectPiece('s-shield-left'); assert.equal(battle.selectedId,null);
  assert.equal(battle.moveTo(TRAINING_ACTIONS[2].to),false);
  reply(); assert.equal(battle.position.ply,2); assert.equal(pending.size,0);
  assert.equal(play(),true); assert.equal(battle.position.winner,1); assert.equal(battle.history.length,4);
  assert.deepEqual(other.position,initial);
});

test('undo cancels a pending reply, including stale callbacks, and undoes complete player turns', () => {
  const { battle,pending,play,reply } = lesson();
  play(); const stale = [...pending.values()][0]; battle.undo(); stale();
  assert.equal(battle.position.ply,0); assert.equal(pending.size,0); assert.equal(battle.history.length,1);
  play(); reply(); battle.undo(); assert.equal(battle.position.ply,0);
  play(); reply(); play(); battle.undo();
  assert.equal(battle.position.ply,2); assert.equal(battle.position.winner,null); assert.equal(battle.history.length,3);
  play(); assert.equal(battle.position.winner,1); battle.undo(); battle.undo(); assert.equal(battle.position.ply,0);
});

test('history is read only and leaving the guide suspends the reply until resuming', () => {
  const { battle,pending,play,reply } = lesson();
  play(); const stale = [...pending.values()][0]; battle.stop(); stale();
  assert.equal(battle.position.ply,1); assert.equal(battle.phase,'paused'); assert.equal(pending.size,0);
  battle.resume(); battle.resume(); assert.equal(pending.size,1); reply();
  battle.review(-1); assert.equal(battle.viewedPosition.ply,1); assert.equal(battle.position.ply,2);
  battle.review(-1); battle.selectPiece('s-shield-left');
  assert.equal(battle.moveTo(TRAINING_ACTIONS[0].to),false); assert.equal(battle.position.ply,2);
  battle.review(1); battle.review(1); assert.equal(battle.reviewIndex,null); play(); assert.equal(battle.position.winner,1);
});

test('training shows incoming preview damage with normal range and aura presentation', () => {
  const {battle}=lesson();
  let html=renderShowcaseBattle(battle,{},renderUnitBadges);
  assert.match(html,/>Учебный бой</); assert.match(html,/id="training-advice"/);
  assert.deepEqual([...html.matchAll(/data-showcase-action="([^"]+)"/g)].map(match=>match[1]),['undo','previous','next']);
  assert.doesNotMatch(html,/Показательный бой|Хватит|Поехали|Начать обучение|НАЧАЛО ОБУЧЕНИЯ|training-advice-title|showcase-legend|Попросить совет|Повторить учебный расчёт|>Атаки<|>Ауры</);
  assert.doesNotMatch(html,/lesson-available|Предпросмотр другого хода/);
  assert.doesNotMatch(html,/data-source=/);
  assert.doesNotMatch(html,/training-hint-arrow-head/);
  battle.selectPiece('s-shield-left'); battle.preview(TRAINING_ACTIONS[0].to);
  html=renderShowcaseBattle(battle,{},renderUnitBadges);
  assert.match(html,/training-preview-token/);
  const forecast = inspectCell(battle.position,battle.config,TRAINING_ACTIONS[0].to,'s-shield-left');
  assert.deepEqual(damageEdges(html),incomingEdges(forecast.report,forecast.piece));
  assert.ok(damageEdges(html).length > 0);
  assert.match(html,/marker-end="url\(#training-damage-arrow-north\)"/);
  assert.doesNotMatch(html,/data-source="s-bow-right" data-target="n-shield-right"/);
  assert.match(html,/data-weapon-cell=/);
  assert.match(html,/data-aura-origin="-1,0"/);
});

test('undo during movement cancels animation without committing a delayed move', () => {
  let tick; let now=0;
  const battle=new ShowcaseBattle({clock:{now:()=>now,requestFrame:cb=>(tick=cb,1),cancelFrame:()=>{}}});
  battle.selectPiece('s-shield-left'); battle.moveTo(TRAINING_ACTIONS[0].to);
  assert.equal(battle.presentation.phase,'movement'); assert.equal(battle.position.ply,0);
  const stale=tick; battle.undo(); now=1000; stale();
  assert.equal(battle.position.ply,0); assert.equal(battle.presentation,null); assert.equal(battle.phase,'ready');
});

test('every legal move of every friendly piece can be previewed without advancing the lesson', () => {
  const { battle, pending } = lesson();
  const snapshot = JSON.stringify({ position: battle.position, history: battle.history, phase: battle.phase });
  for (const piece of battle.position.pieces.filter(piece => piece.team === battle.position.turn)) {
    if (battle.selectedId) battle.clearSelection();
    battle.selectPiece(piece.id);
    const moves = battle.previewMoves;
    assert.ok(moves.length > 0, piece.id);
    for (const destination of moves) {
      battle.preview(destination);
      assert.deepEqual(battle.previewCell, { q: destination.q, r: destination.r });
      const expected = inspectCell(battle.position, battle.config, destination, piece.id);
      assert.equal(expected.isPreview, true);
      const html = renderShowcaseBattle(battle, {}, (info, options) => options.showIncoming ? `forecast:${info.incoming}:${info.fortitude};` : '');
      assert.deepEqual(damageEdges(html), incomingEdges(expected.report, expected.piece));
      assert.match(html, /training-preview-token/);
      assert.match(html, new RegExp(`translate\\(${showcasePoint(destination).x},${showcasePoint(destination).y}\\)`));
      if (expected.report.get(piece.id).incoming > 0) assert.ok(html.includes(`forecast:${expected.report.get(piece.id).incoming}:${expected.report.get(piece.id).fortitude};`));
      assert.equal(JSON.stringify({ position: battle.position, history: battle.history, phase: battle.phase }), snapshot);
      assert.equal(pending.size, 0);
      const approved = TRAINING_ACTIONS[0];
      if (piece.id !== approved.id || destination.q !== approved.to.q || destination.r !== approved.to.r) {
        assert.equal(battle.moveTo(destination), false);
        assert.doesNotMatch(html, /Предпросмотр другого хода|training-preview-note/);
      }
    }
  }
});

test('preview rejects occupied, unreachable and out-of-turn destinations and deduplicates hover updates', () => {
  const { battle } = lesson();
  let updates = 0; battle.onPreview = () => updates++;
  battle.selectPiece('s-shield-right');
  const destination = battle.previewMoves[0];
  battle.preview(destination); battle.preview({ ...destination });
  assert.equal(updates, 1);
  for (const invalid of [null, { q: 99, r: 99 }, { q: -1, r: 2 }]) {
    battle.preview(invalid); assert.equal(battle.previewCell, null);
  }
  battle.selectPiece('n-shield-left');
  assert.deepEqual(battle.previewMoves, []);
  battle.preview({ q: 0, r: 0 }); assert.equal(battle.previewCell, null);
});

test('hovering an occupied cell shows its incoming damage and selection takes priority as in normal battle', () => {
  const { battle } = lesson();
  const enemy = battle.position.pieces.find(piece => piece.id === 'n-shield-right');
  battle.preview(enemy);
  assert.equal(battle.selectedId, null); assert.equal(battle.previewCell, null);
  const html = renderShowcaseBattle(battle, {}, renderUnitBadges);
  const report = analyze(battle.position,battle.config);
  assert.deepEqual(damageEdges(html), incomingEdges(report,enemy));
  assert.ok(damageEdges(html).length > 0);
  assert.match(html,/marker-end="url\(#training-damage-arrow-south\)"/);
  battle.selectPiece('s-shield-left'); battle.preview(enemy);
  const selected = battle.position.pieces.find(piece => piece.id === battle.selectedId);
  assert.deepEqual(damageEdges(renderShowcaseBattle(battle,{},renderUnitBadges)), incomingEdges(report,selected));
  battle.clearSelection();
  battle.preview(null); assert.doesNotMatch(renderShowcaseBattle(battle,{},renderUnitBadges),/data-source=/);
});

test('combat reveals the same lethal contributions in sequence and cancels pending timers on undo', () => {
  const { battle, pending } = lesson();
  battle.selectPiece(TRAINING_ACTIONS[0].id); battle.moveTo(TRAINING_ACTIONS[0].to);
  assert.equal(battle.presentation.phase, 'dimming');
  assert.doesNotMatch(renderShowcaseBattle(battle,{},renderUnitBadges),/data-source=/);
  const phases = [];
  while (battle.presentation) {
    const [handle, callback] = [...pending][0]; pending.delete(handle); callback();
    if (battle.presentation) {
      const html = renderShowcaseBattle(battle,{},renderUnitBadges);
      phases.push({ phase:battle.presentation.phase, arrows:[...html.matchAll(/class="attack-ray"/g)].length });
    }
  }
  assert.deepEqual(phases, [{phase:'attacks',arrows:1},{phase:'attacks',arrows:2},{phase:'deaths',arrows:0}]);
  assert.equal(battle.position.ply,1);
  const html = renderShowcaseBattle(battle,{},renderUnitBadges);
  assert.doesNotMatch(html,/training-preview-token|data-source=/);
  battle.undo(); assert.equal(pending.size,0); assert.equal(battle.position.ply,0);
});

test('both armies reveal only the current combat group in sequence without changing damage or deaths', () => {
  const { battle, play, reply } = lesson();
  let frames = 0, combatPhases = 0;
  battle.onChange = () => {
    const html = renderShowcaseBattle(battle, {}, renderUnitBadges);
    assert.doesNotMatch(html, /training-preview-note/);
    const presentation = battle.presentation;
    if (presentation?.phase === 'attacks') {
      const expected = presentation.combat.groups[presentation.groupIndex].arrows.slice(0,presentation.arrowCount).map(attack => `${attack.source.id}:${attack.target.id}`).sort();
      assert.deepEqual(damageEdges(html),expected);
      combatPhases++;
    } else if (presentation && presentation.phase !== 'movement') assert.deepEqual(damageEdges(html),[]);
    frames++;
  };
  battle.selectPiece('s-shield-left'); battle.preview(TRAINING_ACTIONS[0].to);
  const html = renderShowcaseBattle(battle, {}, renderUnitBadges);
  assert.match(html, /Входящий урон: 5/);
  battle.clearSelection(); play(); reply();
  assert.ok(!battle.position.pieces.some(piece => piece.id === 's-shield-right'));
  play(); assert.equal(battle.position.winner, 1);
  assert.ok(frames > 6); assert.ok(combatPhases > 0);
});

test('play again appears after victory and restores an isolated initial lesson', () => {
  const { battle, pending, play, reply } = lesson();
  const initial = structuredClone(battle.position);
  assert.doesNotMatch(renderShowcaseBattle(battle,{},renderUnitBadges), /data-showcase-action="restart"/);
  play(); reply(); play();
  assert.equal(battle.position.winner, 1);
  assert.match(renderShowcaseBattle(battle,{},renderUnitBadges), /data-showcase-action="restart">Сыграть ещё раз/);
  battle.restart();
  assert.deepEqual(battle.position, initial); assert.deepEqual(battle.history, [initial]);
  assert.equal(battle.selectedId,null); assert.equal(battle.previewCell,null); assert.equal(battle.hoverCell,null);
  assert.equal(battle.reviewIndex,null); assert.equal(battle.presentation,null); assert.equal(pending.size,0);
  assert.equal(battle.phase,'ready'); assert.equal(play(),true);
  const staleReply = [...pending.values()][0];
  battle.restart(); staleReply();
  assert.deepEqual(battle.position, initial); assert.equal(pending.size,0);
});

test('advice arrows stay hidden on both player turns, during forecasts and after victory', () => {
  const { battle, play, reply } = lesson();
  const noArrows = () => assert.doesNotMatch(renderShowcaseBattle(battle,{},renderUnitBadges), /class="hint-trace"|training-hint-arrow-head/);
  noArrows(); play(); noArrows(); reply(); noArrows();
  assert.equal(battle.position.ply,2);
  battle.selectPiece('s-bow-right'); battle.preview(battle.previewMoves[0]); noArrows();
  battle.clearSelection(); play(); noArrows();
});
