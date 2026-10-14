/**
 * economy.js - the coins / stars / repair bookkeeping behind 9.6 ("drift score
 * feeds star challenges and bonus coins") and 9.9 ("repair between missions
 * costs coins... one free quick repair per mission").
 *
 * All numbers come from `tuning.economy`; the challenges are data, so adding one
 * is a JSON edit. A challenge is a metric + a target:
 *
 *   driftScore   the best drift total in the session
 *   bestLap      a lap time to beat, in seconds
 *   topSpeedKph  a speed to reach
 *   stylePoints  accumulated style points
 *   nearMisses   how many close calls
 *   damage       how little damage you finished a mission with
 *
 * Metrics are monotonic "best so far" values, so a challenge, once earned, keeps
 * its star for the session.
 */

export class Economy {
  constructor(config) {
    this.config = config;
    this.tuning = config.tuning.economy;
    this.challenges = (this.tuning.challenges ?? []).map((c) => ({ ...c, earned: false }));
    this.reset();
  }

  reset() {
    this.coins = this.tuning.startCoins;
    this.earned = 0;
    this.spent = 0;
    this.style = 0;
    this.bestDrift = 0;
    this.bestLap = Infinity;
    this.topSpeedKph = 0;
    this.nearMisses = 0;
    this.lowestHealthPct = 1;
    this.freeQuickRepairs = this.tuning.freeQuickRepairs;
    this.repairs = 0;
    for (const challenge of this.challenges) challenge.earned = false;
    this.events = [];
  }

  add(coins, reason = 'style') {
    if (!(coins > 0)) return 0;
    this.coins += coins;
    this.earned += coins;
    this.events.push({ type: 'coins', amount: Math.round(coins), reason });
    return coins;
  }

  spend(coins, reason = 'repair') {
    if (coins > this.coins) return false;
    this.coins -= coins;
    this.spent += coins;
    this.events.push({ type: 'spend', amount: Math.round(coins), reason });
    return true;
  }

  /** The current value of a challenge metric. */
  metric(id) {
    switch (id) {
      case 'driftScore':
        return this.bestDrift;
      case 'bestLap':
        return this.bestLap;
      case 'topSpeedKph':
        return this.topSpeedKph;
      case 'stylePoints':
        return this.style;
      case 'nearMisses':
        return this.nearMisses;
      case 'lowestHealthPct':
        return this.lowestHealthPct;
      default:
        return 0;
    }
  }

  /** Does a value meet a target? Lap times and health are "lower is better". */
  static meets(metric, value, target) {
    if (metric === 'bestLap') return value > 0 && value < target;
    if (metric === 'lowestHealthPct') return value > target;
    return value >= target;
  }

  /** Re-check every challenge; returns the ones that just earned a star this call. */
  check() {
    const justEarned = [];
    for (const challenge of this.challenges) {
      if (challenge.earned) continue;
      if (Economy.meets(challenge.metric, this.metric(challenge.metric), challenge.target)) {
        challenge.earned = true;
        const reward = challenge.reward ?? this.tuning.coinsPerStar;
        this.coins += reward;
        this.earned += reward;
        justEarned.push({ ...challenge, reward });
        this.events.push({ type: 'star', id: challenge.id, name: challenge.name, reward });
      }
    }
    return justEarned;
  }

  get stars() {
    return this.challenges.filter((c) => c.earned).length;
  }

  get totalStars() {
    return this.challenges.length;
  }

  /**
   * 9.6: bank a finished drift.
   * @returns {{coins:number, stars:object[]}}
   */
  bankDrift(points) {
    const coins = this.add(points * this.tuning.coinsPerStylePoint, 'drift');
    this.bestDrift = Math.max(this.bestDrift, points);
    return { coins, stars: this.check() };
  }

  /** 9.10: a close call paid out. */
  bankNearMiss() {
    this.nearMisses += 1;
    this.add(this.tuning.coinsPerNearMiss, 'nearMiss');
    return this.check();
  }

  bankStyle(points) {
    this.style += points;
    return this.check();
  }

  bankLap(seconds) {
    if (seconds > 0 && seconds < this.bestLap) this.bestLap = seconds;
    this.add(this.tuning.coinsPerLap, 'lap');
    return this.check();
  }

  bankSpeed(kph) {
    this.topSpeedKph = Math.max(this.topSpeedKph, kph);
    return this.check();
  }

  bankHealth(pct) {
    this.lowestHealthPct = Math.min(this.lowestHealthPct, pct);
    return this.check();
  }

  /**
   * 9.9: repair, paying for it (or using the mission's free quick repair).
   *
   * @returns {{ok:boolean, cost:number, restored:number, free:boolean, reason?:string}}
   */
  repair(damage /* DamageModel */) {
    const cost = damage.repairCost();
    if (cost === 0) return { ok: true, cost: 0, restored: 0, free: false };
    const useFree = this.freeQuickRepairs > 0;
    if (!useFree && !this.spend(cost, 'repair')) {
      return { ok: false, cost, restored: 0, free: false, reason: 'not enough coins' };
    }
    const result = damage.repair(this.coins, useFree);
    if (!result.ok) {
      if (!useFree) this.coins += cost; // refund
      return { ok: false, cost, restored: 0, free: false, reason: result.reason };
    }
    if (useFree) this.freeQuickRepairs -= 1;
    this.repairs += 1;
    this.events.push({ type: 'repair', cost: useFree ? 0 : cost, free: useFree, restored: Math.round(result.restored) });
    return { ok: true, cost: useFree ? 0 : cost, restored: result.restored, free: useFree };
  }

  takeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }
}
