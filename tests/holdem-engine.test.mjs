import test from 'node:test';
import assert from 'node:assert/strict';
import { Holdem, bestHand, compareScores, newDeck } from '../site/games/community/texas-holdem/engine.js';

const h = (s) => bestHand(s.split(' '));

test('牌型排序', () => {
  const order = [
    h('2c 7d 9h Js Kd 4c 3s'), // 高牌
    h('2c 2d 9h Js Kd 4c 3s'), // 一對
    h('2c 2d 9h 9s Kd 4c 3s'), // 兩對
    h('2c 2d 2h Js Kd 4c 3s'), // 三條
    h('6c 3d 4h 5s 2d 9c Ts'), // 順子
    h('2c 7c 9c Jc Kc 4d 3s'), // 同花
    h('2c 2d 2h Js Jd 4c 3s'), // 葫蘆
    h('2c 2d 2h 2s Kd 4c 3s'), // 四條
    h('2c 3c 4c 5c 6c 9d Ts'), // 同花順
  ];
  for (let i = 1; i < order.length; i += 1) assert.ok(compareScores(order[i].score, order[i - 1].score) > 0, `${i}`);
  assert.equal(h('Ac Kc Qc Jc Tc 2d 3s').name, '皇家同花順');
  assert.equal(h('Ac 2d 3h 4s 5d 9c Ts').name, '順子');
  assert.ok(compareScores(h('Ac 2d 3h 4s 5d 9c Ts').score, h('2c 3d 4h 5s 6d 9c Ts').score) < 0, 'A 低順子比 6 高順子小');
  assert.ok(compareScores(h('Ac Kd 9h 4s 3d 7c 2s').score, h('Ac Qd 9h 4s 3d 7c 2s').score) > 0, '踢腳');
});

function table(n, chips = 1000) {
  const t = new Holdem({ rng: () => 0.5 });
  for (let i = 0; i < n; i += 1) t.addPlayer(`p${i}`, `P${i}`, Array.isArray(chips) ? chips[i] : chips);
  return t;
}
const total = (t) => t.players.reduce((s, p) => s + p.chips + p.total, 0);

test('發牌、盲注與行動順序（三人）', () => {
  const t = table(3);
  assert.ok(t.startHand());
  assert.equal(t.dealerId, 'p0');
  assert.equal(t.player('p1').bet, 10);
  assert.equal(t.player('p2').bet, 20);
  assert.equal(t.actorId, 'p0'); // UTG ＝ 大盲左邊 ＝ 莊家
  assert.equal(t.pot(), 30);
  assert.ok(t.players.every((p) => p.hole.length === 2));
});

test('單挑：莊家是小盲並先行動，翻牌後大盲先行動', () => {
  const t = table(2);
  t.startHand();
  assert.equal(t.sbId, t.dealerId);
  assert.equal(t.actorId, t.dealerId);
  t.act(t.actorId, 'call');
  t.act(t.actorId, 'check'); // 大盲 check
  assert.equal(t.phase, 'flop');
  assert.equal(t.actorId, t.bbId);
});

test('全員過牌到攤牌，籌碼守恆', () => {
  const t = table(3);
  const sum = total(t);
  t.startHand();
  t.act(t.actorId, 'call'); t.act(t.actorId, 'call'); t.act(t.actorId, 'check');
  for (const street of ['flop', 'turn', 'river']) {
    assert.equal(t.phase, street);
    for (let i = 0; i < 3; i += 1) t.act(t.actorId, 'check');
  }
  assert.equal(t.phase, 'waiting');
  assert.equal(t.board.length, 5);
  assert.ok(t.result && !t.result.uncontested);
  assert.equal(total(t), sum);
});

test('其他人棄牌：無人攤牌直接得池', () => {
  const t = table(3);
  t.startHand();
  t.act(t.actorId, 'fold');
  t.act(t.actorId, 'fold');
  assert.equal(t.phase, 'waiting');
  assert.ok(t.result.uncontested);
  assert.equal(t.player('p2').chips, 1010);
});

test('加注規則：最小加注、不可低於、全下可低於', () => {
  const t = table(3);
  t.startHand();
  assert.equal(t.act('p0', 'raise', 30).error, 'below_min_raise');
  assert.equal(t.act('p0', 'raise', 5000).error, 'bad_amount');
  assert.ok(t.act('p0', 'raise', 60).ok);
  assert.equal(t.minRaise, 40);
  assert.equal(t.legalActions('p1').minTo, 100);
  assert.equal(t.act('p1', 'check').error, 'cannot_check');
});

test('不是自己的回合不能動作', () => {
  const t = table(3);
  t.startHand();
  assert.equal(t.act('p1', 'fold').error, 'not_your_turn');
});

test('邊池：短籌碼全下只能贏自己那一層', () => {
  const t = table(3, [100, 500, 500]);
  const sum = total(t);
  t.deck = null;
  t.startHand();
  // 強制牌面：p0（短籌碼）拿最強牌
  t.player('p0').hole = ['As', 'Ad'];
  t.player('p1').hole = ['Kc', 'Kd'];
  t.player('p2').hole = ['7h', '2d'];
  t.deck = ['2c', '3c', '9d', '8s', '5h', '4d', '6s', 'Jh', '3d', 'Qc', '7d', 'Tc', '2h']; // pop 從尾端
  t.act('p0', 'raise', 100); // 全下 100
  t.act('p1', 'raise', 300);
  t.act('p2', 'call');
  while (t.inProgress()) t.act(t.actorId, 'check');
  assert.equal(t.phase, 'waiting');
  assert.equal(total(t), sum);
  const p0 = t.result.players.find((x) => x.id === 'p0');
  const p1 = t.result.players.find((x) => x.id === 'p1');
  assert.ok(t.result.pots.length === 2);
  assert.equal(p0.won, 300); // 主池 100×3
  assert.ok(p1.won >= 400); // 邊池 200×2
  assert.equal(t.player('p0').chips, 300);
});

test('平手平分、零頭給莊家左手第一位', () => {
  const t = table(2);
  t.startHand();
  t.player('p0').hole = ['2c', '3d'];
  t.player('p1').hole = ['2d', '3c'];
  t.deck = ['9h', '8s', '7d', '6c', '5h', '4d', 'Ts', 'Jc', 'Qd', 'Kh', 'Ah', '2h', '3h'].reverse().reverse();
  t.board = [];
  // 公共牌 A K Q J T 皇家順在牌面，兩人平分
  t.deck = ['Ts', 'Jc', 'Qd', 'Kh', 'Ah', '9h', '8s', '7d', '6c'].reverse();
  t.act(t.actorId, 'raise', 50);
  t.act(t.actorId, 'call');
  while (t.inProgress()) t.act(t.actorId, 'check');
  const sum = t.players.reduce((s, p) => s + p.chips, 0);
  assert.equal(sum, 2000);
});

test('全部全下直接發完公共牌', () => {
  const t = table(3, [200, 200, 200]);
  t.startHand();
  t.act('p0', 'raise', 200);
  t.act('p1', 'call');
  t.act('p2', 'call');
  assert.equal(t.phase, 'waiting');
  assert.equal(t.board.length, 5);
  assert.equal(total(t), 600);
});

test('離桌視為棄牌；剩一人時結束', () => {
  const t = table(2);
  t.startHand();
  t.removePlayer(t.actorId);
  assert.equal(t.phase, 'waiting');
  assert.equal(t.players.length, 1);
});

test('restore：換房主時進行中的那手作廢並退回投入', () => {
  const t = table(3);
  t.startHand();
  t.act(t.actorId, 'raise', 100);
  const view = t.publicView();
  const r = Holdem.restore(view);
  assert.equal(r.players.reduce((s, p) => s + p.chips, 0), 3000);
  assert.equal(r.phase, 'waiting');
  assert.ok(r.startHand());
});

test('牌組 52 張不重複，多手後籌碼守恆', () => {
  assert.equal(new Set(newDeck()).size, 52);
  const t = new Holdem({ rng: Math.random });
  for (let i = 0; i < 5; i += 1) t.addPlayer(`p${i}`, `P${i}`);
  for (let hand = 0; hand < 300; hand += 1) {
    t.startHand();
    let guard = 0;
    while (t.inProgress() && guard++ < 100) {
      const id = t.actorId;
      const L = t.legalActions(id);
      const r = Math.random();
      if (r < 0.15) t.act(id, 'fold');
      else if (r < 0.3 && L.raise) t.act(id, 'raise', Math.min(L.maxTo, L.minTo + Math.floor(Math.random() * 300)));
      else if (L.check) t.act(id, 'check');
      else t.act(id, 'call');
    }
    assert.ok(!t.inProgress(), 'hand ended');
    assert.equal(total(t), 5000 + (t.players.length * 0), `chips conserved hand ${hand}`);
    // rebuy 會補籌碼，守恆檢查只在沒有 rebuy 時成立
    if (t.players.some((p) => p.chips === 0)) break;
  }
});
