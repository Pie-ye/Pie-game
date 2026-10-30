// 社交面板：拜訪名冊、訪客選單、信箱、玩家名片、表情。
import { openPanel, closePanel } from './panels.js';
import { atlasIcon } from './icon.js';
import { lookSheet } from '../engine/sprites.js';
import { defaultLook } from '../avatar/look.js';
import { EMOTES, EMOTE_NAMES, NOTE_MAX, itemName, giftable } from '../social/home.js';
import { HOUSE_STYLES } from '../house/catalog.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/** 角色正面小頭像（canvas）。 */
export function avatar(scene, look, id, size = 32) {
  const c = el('canvas', 'avatar'); c.width = size; c.height = size;
  const sh = lookSheet(scene, look || defaultLook(id)), x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  if (sh) x.drawImage(sh, 0, 0, 16, 16, 0, 0, size, size);
  return c;
}

function row(scene, { id, name, look, style, likes, crops, online, friend }, actions) {
  const r = el('div', 'person-row');
  r.append(avatar(scene, look, id));
  const info = el('div', 'person-info');
  const top = el('b', null, `${friend ? '★ ' : ''}${name}`);
  const sub = el('small');
  const bits = [];
  if (online) bits.push('🟢 在線上');
  if (style && HOUSE_STYLES[style]) bits.push(HOUSE_STYLES[style]);
  if (likes != null) bits.push(`👍 ${likes}`);
  if (crops != null) bits.push(`🌱 ${crops}`);
  sub.textContent = bits.join('　');
  info.append(top, sub);
  r.append(info);
  for (const a of actions) r.append(a);
  return r;
}

/**
 * 拜訪名冊。lists：{ online:[{id,name,look}], friends:[{id,name,online}], cards: Promise<[{id,name,look,style,likes,crops}]> }
 * opts：{ myOpen, onToggleOpen(open), onVisit(id,name), onFriend(id,name) → 是否為好友, isFriend(id) }
 */
export function openVisitPanel(scene, lists, opts) {
  const body = openPanel('拜訪家園');
  const mine = el('label', 'chk-line');
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = opts.myOpen;
  cb.addEventListener('change', () => opts.onToggleOpen(cb.checked));
  mine.append(cb, document.createTextNode(' 開放我的家園給別人拜訪'));
  body.append(mine);
  const section = (title) => { const h = el('h3', null, title); body.append(h); const box = el('div', 'people'); body.append(box); return box; };
  const visitBtn = (p) => btn('拜訪', () => { closePanel(); opts.onVisit(p.id, p.name); });
  const starBtn = (p) => { const b = btn(opts.isFriend(p.id) ? '★' : '☆', () => { b.textContent = opts.onFriend(p.id, p.name) ? '★' : '☆'; }, 'star'); b.title = '好友'; return b; };
  const coopBtn = (p) => { const b = btn(opts.isCoop(p.id) ? '🤝 共耕中' : '🤝 邀請共耕', async () => { b.disabled = true; b.textContent = (await opts.onCoop(p.id, p.name)) ? '🤝 共耕中' : '🤝 邀請共耕'; b.disabled = false; }, 'coop'); b.title = '讓對方可以在你的農場使用所有農具'; return b; };
  const on = section('現在在線上的鎮民');
  if (!lists.online.length) on.append(el('p', 'note', '現在只有你在線上。'));
  for (const p of lists.online) on.append(row(scene, { ...p, online: true, friend: opts.isFriend(p.id) }, [starBtn(p), visitBtn(p)]));
  const fr = section('好友');
  if (!lists.friends.length) fr.append(el('p', 'note', '在名冊或玩家名片按 ☆ 加好友。好友可以邀請來共同耕作。'));
  for (const p of lists.friends) fr.append(row(scene, { ...p, friend: true }, [starBtn(p), coopBtn(p), visitBtn(p)]));
  const all = section('鎮民名冊（開放拜訪的家園）');
  all.append(el('p', 'note', '讀取中…'));
  lists.cards.then((cards) => {
    all.textContent = '';
    if (!cards.length) all.append(el('p', 'note', '還沒有人開放家園。'));
    for (const p of cards) all.append(row(scene, { ...p, friend: opts.isFriend(p.id) }, [starBtn(p), visitBtn(p)]));
  }).catch(() => { all.textContent = ''; all.append(el('p', 'note', '名冊暫時讀不到，稍後再試。')); });
}

/** 拜訪別人家時，在對方信箱前：按讚、留言、送禮、加好友。 */
export function openVisitorMenu(scene, host, inv, opts) {
  const body = openPanel(`${host.name}的信箱`);
  body.append(row(scene, { id: host.id, name: host.name, look: host.look, likes: host.likes, friend: opts.isFriend(host.id) }, []));
  if (host.coop) body.append(el('p', 'note', '🤝 你是這裡的共同耕作夥伴：所有農具都能用，收成會放進主人的背包。'));
  const like = btn(opts.canLike ? '👍 稱讚這個家園' : '👍 今天已經稱讚過了', () => { opts.onLike(); like.disabled = true; like.textContent = '👍 已稱讚！'; });
  like.disabled = !opts.canLike;
  const fr = btn(opts.isFriend(host.id) ? '★ 已是好友（取消）' : '☆ 加為好友', () => { fr.textContent = opts.onFriend() ? '★ 已是好友（取消）' : '☆ 加為好友'; });
  body.append(el('div', 'menu-btns'));
  body.lastChild.append(like, fr);
  body.append(el('h3', null, '留言'));
  const ta = el('textarea'); ta.maxLength = NOTE_MAX; ta.rows = 3; ta.placeholder = `寫點什麼給${host.name}（${NOTE_MAX} 字內）`;
  const send = btn('投進信箱', () => { if (ta.value.trim()) { opts.onNote(ta.value); ta.value = ''; send.textContent = '已投遞 ✓'; setTimeout(() => { send.textContent = '投進信箱'; }, 1500); } });
  body.append(ta, send);
  body.append(el('h3', null, '送禮（從背包拿 1 個）'));
  const gifts = el('div', 'grid-items');
  const items = giftable(inv);
  if (!items.length) gifts.append(el('p', 'note', '背包裡沒有可以送的作物或魚。'));
  for (const [k, n] of items) {
    const b = el('button'); b.type = 'button';
    const icon = atlasIcon(k.startsWith('fish_') ? `fish${k[5].toUpperCase()}${k.slice(6)}` : `${k}Item`, 32);
    b.append(icon, el('span', null, `${itemName(k)} ×${n}`));
    b.addEventListener('click', () => { if (opts.onGift(k)) { b.remove(); openVisitorMenu(scene, host, inv, opts); } });
    gifts.append(b);
  }
  body.append(gifts);
}

/** 自己的信箱。items：readMail 整理過的信。 */
export function openMailbox(items, opts) {
  const body = openPanel('我的信箱');
  if (!items.length) { body.append(el('p', 'note', '信箱是空的。去拜訪別人、留言給大家吧！')); return; }
  const likes = items.filter((m) => m.kind === 'like');
  if (likes.length) {
    const card = el('div', 'mail like');
    card.append(el('b', null, `👍 ${likes.length} 個新的稱讚`), el('p', null, likes.slice(0, 8).map((m) => m.from.name).join('、') + (likes.length > 8 ? '…' : '')));
    card.append(btn('知道了', () => { opts.onRead(likes); card.remove(); }));
    body.append(card);
  }
  for (const m of items.filter((x) => x.kind !== 'like')) {
    const card = el('div', `mail ${m.kind}`);
    if (m.kind === 'note') {
      card.append(el('b', null, `✉ ${m.from.name}`), el('p', null, m.text));
      card.append(btn('拜訪', () => { opts.onVisit(m.from.id, m.from.name); }), btn('刪除', () => { opts.onDelete(m); card.remove(); }));
    } else if (m.kind === 'gift') {
      card.append(el('b', null, `🎁 ${m.from.name} 送你 ${itemName(m.item)} ×${m.n}`));
      card.append(btn('收下', () => { opts.onClaim(m); card.remove(); }));
    } else if (m.kind === 'sold') {
      card.append(el('b', null, `💰 ${m.from.name} 買下了你的 ${itemName(m.item)} ×${m.n}`), el('p', null, `${m.price} G 已經入帳。`));
      card.append(btn('知道了', () => { opts.onRead([m]); card.remove(); }));
    } else if (m.kind === 'coop') {
      card.append(el('b', null, `🤝 ${m.from.name} 邀請你共同耕作`), el('p', null, '你可以在他的農場使用所有農具。'));
      card.append(btn('去看看', () => { opts.onRead([m]); opts.onVisit(m.from.id, m.from.name); }), btn('知道了', () => { opts.onRead([m]); card.remove(); }));
    }
    body.append(card);
  }
}

/** 點別的玩家：名片。 */
export function openPlayerCard(scene, p, opts) {
  const body = openPanel(p.name);
  body.append(row(scene, { ...p, online: true, friend: opts.isFriend(p.id) }, []));
  const box = el('div', 'menu-btns');
  const fr = btn(opts.isFriend(p.id) ? '★ 好友（取消）' : '☆ 加為好友', () => { fr.textContent = opts.onFriend() ? '★ 好友（取消）' : '☆ 加為好友'; });
  const co = btn(opts.isCoop(p.id) ? '🤝 共耕中（取消）' : '🤝 邀請共同耕作', async () => { co.disabled = true; co.textContent = (await opts.onCoop()) ? '🤝 共耕中（取消）' : '🤝 邀請共同耕作'; co.disabled = false; });
  box.append(btn('🏡 拜訪家園', () => { closePanel(); opts.onVisit(); }), btn('👋 打招呼', () => { opts.onWave(); closePanel(); }), fr, co);
  body.append(box);
}

/** 表情選單。 */
export function openEmotes(onPick) {
  const body = openPanel('表情（T）');
  const grid = el('div', 'grid-items');
  EMOTES.forEach((n, i) => {
    const b = el('button'); b.type = 'button'; b.title = EMOTE_NAMES[i];
    b.append(atlasIcon(`emote${n}`, 40), el('span', null, `${i === 9 ? 0 : i + 1}. ${EMOTE_NAMES[i]}`));
    b.addEventListener('click', () => { onPick(i); closePanel(); });
    grid.append(b);
  });
  body.append(grid);
}
