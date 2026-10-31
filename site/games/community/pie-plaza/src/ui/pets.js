// 寵物診所面板：領養（金幣或成就解鎖）、選擇帶在身邊的寵物。
import { openPanel } from './panels.js';
import { PET_BY, petSheet } from '../game/pets.js';
import { assetUrl } from '../engine/sprites.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn) => { const b = el('button', null, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/** 寵物小圖：取第一格（坐著），放大三倍。 */
function petIcon(id) {
  const i = el('i', 'pet-icon');
  const img = new Image();
  img.onload = () => {
    const fw = img.width / 2;
    i.style.width = `${fw * 3}px`; i.style.height = `${img.height * 3}px`;
    i.style.backgroundImage = `url("${assetUrl(petSheet(id))}")`;
    i.style.backgroundSize = `${img.width * 3}px ${img.height * 3}px`;
  };
  img.src = assetUrl(petSheet(id));
  return i;
}

/** data：伺服器 pets view；api：{ adopt(id), choose(id|null) } 都回傳新的 view。 */
export function openPets(data, api) {
  const body = openPanel('哈醫生寵物診所');
  const paint = (v) => {
    body.replaceChildren();
    body.append(el('p', 'note', '寵物會跟在你身後，大家都看得到。有的用金幣領養，有的要達成成就才肯跟你回家。'));
    const msg = el('p', 'note');
    const grid = el('div', 'grid-items pets');
    for (const p of v.list) {
      const card = el('div', `pet-card${p.owned ? ' owned' : ''}${v.on === p.id ? ' on' : ''}`);
      const how = PET_BY[p.id] && PET_BY[p.id].how;
      card.append(petIcon(p.id), el('b', null, p.name));
      if (p.owned) {
        card.append(v.on === p.id ? btn('收起來', async () => { try { paint(await api.choose(null)); } catch (e) { msg.textContent = e.msg || '不行'; } })
          : btn('帶著牠', async () => { try { paint(await api.choose(p.id)); msg.textContent = `${p.name}跟著你了！`; } catch (e) { msg.textContent = e.msg || '不行'; } }));
      } else if (!p.unlocked) {
        card.append(el('small', null, `🔒 ${how || '還沒解鎖'}`));
      } else {
        card.append(btn(p.price ? `領養 ${p.price} G` : '免費領養', async () => {
          try { paint(await api.adopt(p.id)); msg.textContent = `歡迎${p.name}回家！`; } catch (e) { msg.textContent = e.msg || '領養不了'; }
        }));
      }
      grid.append(card);
    }
    body.append(grid, msg);
  };
  paint(data);
}
