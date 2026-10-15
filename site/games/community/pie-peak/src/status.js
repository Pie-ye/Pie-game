// Stamina + afflictions, the heart of PEAK: every affliction eats into the stamina CAP, weight too.
// Zero cap = unconscious. All values are 0..100 "bar units" of the stamina bar.
export const AFFLICTIONS = {
  hunger:  { label: '飢餓',  color: '#e8a73a' },
  injury:  { label: '受傷',  color: '#e04a4a' },
  poison:  { label: '中毒',  color: '#9a4ad8' },
  cold:    { label: '寒冷',  color: '#4ab4ea' },
  hot:     { label: '灼熱',  color: '#ee6a2a' },
  drowsy:  { label: '睏倦',  color: '#6a74c8' },
  weight:  { label: '負重',  color: '#8a8a8a' },
};
export const ORDER = ['injury', 'poison', 'hunger', 'cold', 'hot', 'drowsy', 'weight'];

export class Vitals {
  constructor() {
    this.stamina = 100;
    this.aff = { hunger: 0, injury: 0, poison: 0, cold: 0, hot: 0, drowsy: 0, weight: 0 };
    this.buffs = {};           // name -> seconds remaining
    this.poisonTicks = 0;      // seconds of active poisoning (poison keeps growing while > 0)
    this.sleepTimer = 0;       // forced sleep after a sugar crash
  }
  get cap() {
    let c = 100;
    for (const k of ORDER) c -= this.aff[k];
    return Math.max(0, c);
  }
  get down() { return this.cap <= 0.5; }
  add(name, amount) {
    this.aff[name] = Math.min(100, Math.max(0, this.aff[name] + amount));
    this.stamina = Math.min(this.stamina, this.cap);
  }
  restore(amount) { this.stamina = Math.min(this.cap, this.stamina + amount); }
  has(buff) { return (this.buffs[buff] || 0) > 0; }
  grant(buff, seconds) { this.buffs[buff] = Math.max(this.buffs[buff] || 0, seconds); }
  // Spend stamina; returns false if there was not enough (caller decides what that means).
  spend(amount) {
    if (this.has('infinite')) return true;
    if (this.has('boost')) amount *= 0.4;
    if (this.stamina < amount) { this.stamina = 0; return false; }
    this.stamina -= amount; return true;
  }
  // Called every frame with environment flags: {resting, exposedCold, exposedHot, warm, cool, sheltered}
  tick(dt, env = {}) {
    for (const k of Object.keys(this.buffs)) {
      this.buffs[k] -= dt;
      if (this.buffs[k] <= 0) {
        delete this.buffs[k];
        if (k === 'boost') this.crash();
        if (k === 'infinite') this.add('drowsy', 12);
      }
    }
    // Hunger creeps up; it never stops until you eat.
    this.add('hunger', dt * 0.13);
    // Poison grows while active, then slowly wears off by itself.
    if (this.poisonTicks > 0) { this.poisonTicks -= dt; this.add('poison', dt * 2.2); }
    else if (this.aff.poison > 0) this.add('poison', -dt * 0.5);
    // Temperature
    const warm = env.warm || this.has('warmed'), cool = env.cool || this.has('cooled');
    if (env.exposedCold && !warm && !env.sheltered) this.add('cold', dt * (env.wind ? 0.95 : 0.5) * (env.coldMul ?? 1));
    else if (this.aff.cold > 0) this.add('cold', -dt * (warm ? 6 : 0.8));
    if (env.exposedHot && !cool) this.add('hot', dt * 0.55);
    else if (this.aff.hot > 0) this.add('hot', -dt * (cool ? 6 : 1.0));
    // Drowsiness is the sugar crash; it fades.
    if (this.aff.drowsy > 0) this.add('drowsy', -dt * 1.5);
    if (this.sleepTimer > 0) this.sleepTimer -= dt;
    // Injuries heal very slowly at camp / shrine.
    if (env.camp && this.aff.injury > 0) this.add('injury', -dt * 3);
    this.stamina = Math.min(this.stamina, this.cap);
  }
  crash() { this.sleepTimer = 3.5; this.add('drowsy', 15); this.add('hunger', 8); }
  setWeight(units) { this.aff.weight = Math.min(60, Math.round(units * 10) / 10); this.stamina = Math.min(this.stamina, this.cap); }
  fallDamage(distance) {
    if (distance < 6) return 0;
    const dmg = (distance - 6) * 2.6;
    this.add('injury', dmg);
    return dmg;
  }
  clearAll() { for (const k of Object.keys(this.aff)) if (k !== 'weight') this.aff[k] = 0; this.poisonTicks = 0; }
}
