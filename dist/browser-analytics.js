import { ArchiveIndexedDBStorage } from './game-archive.js';

// A separate bounded queue keeps analytics failures out of game state and controls.
export class BrowserAnalytics {
  constructor({ enabled = false, geoEnabled = false, geoTimeoutMs = 2500, endpoint = '', storage = null, identity = new ArchiveIndexedDBStorage(globalThis.indexedDB), fetch = globalThis.fetch?.bind(globalThis), uuid = () => crypto.randomUUID(), now = () => Date.now() } = {}) {
    this.enabled = enabled; this.endpoint = endpoint; this.storage = storage;
    this.geoEnabled = geoEnabled; this.geoTimeoutMs = geoTimeoutMs; this.geoKey = 'trows-ipapi-location-v1';
    if (!storage) { try { this.storage=globalThis.localStorage; } catch {} } this.identity = identity; this.fetch = fetch; this.uuid = uuid; this.now = now;
    this.sessionId = uuid(); this.context = null; this.last = now(); this.pendingSeconds = 0; this.key = `trows-analytics-${this.sessionId}`; this.queue = []; this.chain = Promise.resolve();
  }
  event(type, extra = {}) {
    if (!this.enabled) return;
    this.chain = this.chain.then(async () => {
      if (!this.playerId) this.playerId = await this.identity.getOrCreatePlayerId(this.uuid);
      this.queue.push({ id:this.uuid(), sessionId:this.sessionId, type, at:new Date(this.now()).toISOString(), seconds:0, ...extra });
      this.queue = this.queue.slice(-500); this.save();
    }).then(() => { void this.flush(); }).catch(() => {});
  }
  save() { try { this.storage?.setItem(this.key, JSON.stringify({playerId:this.playerId,events:this.queue})); } catch {} }
  async location() {
    if (!this.enabled || !this.geoEnabled || !this.fetch) return null;
    if (this.geoPending) return this.geoPending;
    const time = this.now();
    let cached = this.geoCache;
    try { cached = JSON.parse(this.storage?.getItem(this.geoKey) || 'null') || cached; } catch {}
    const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,100) || null : null;
    const normalize = value => {
      if (!value || typeof value !== 'object') return null;
      const geo = {source:'ipapi.is',country:clean(value.country),region:clean(value.region),city:clean(value.city)};
      return geo.city ? geo : null;
    };
    if (Number.isFinite(cached?.retryAt) && cached.retryAt > time && cached.retryAt <= time + 86400_000) return normalize(cached.geo);
    const save = (geo, delay) => {
      this.geoCache = {retryAt:this.now()+delay,geo};
      try { this.storage?.setItem(this.geoKey,JSON.stringify(this.geoCache)); } catch {}
    };
    // A short cross-tab lease, followed by a daily cache, protects the anonymous quota.
    save(null,60_000);
    this.geoPending = (async () => {
      const controller = new AbortController();
      let timeout;
      try {
        const {response,raw} = await Promise.race([
          (async () => {
            const response = await this.fetch('https://api.ipapi.is/',{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
            return {response,raw:response.ok ? await response.json() : null};
          })(),
          new Promise((_,reject) => { timeout=setTimeout(() => {controller.abort();reject(new Error('Geo timeout'));},this.geoTimeoutMs); }),
        ]);
        if (!response.ok) { save(null,response.status===429 ? 86400_000 : 3600_000); return null; }
        // Support both the anonymous response and the older nested location format.
        const value = raw?.location ? {country:raw.location.country_code || raw.location.country,region:raw.location.state,city:raw.location.city} : raw;
        const geo = raw?.error ? null : normalize(value);
        // Never retain or send the response's IP, coordinates, ASN or company.
        save(geo,geo ? 86400_000 : 3600_000);
        return geo;
      } catch { save(null,3600_000); return null; }
      finally { clearTimeout(timeout); }
    })().finally(() => { this.geoPending=null; });
    return this.geoPending;
  }
  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = this.send().finally(() => { this.flushing=null; });
    return this.flushing;
  }
  async send() {
    if (!this.enabled || !this.fetch) return;
    this.sending = true;
    try {
      // Recover queues left by closed/reloaded tabs; event IDs make retries safe.
      const keys = [];
      try { for (let i=0;i<this.storage.length;i++) { const key=this.storage.key(i); if (key?.startsWith('trows-analytics-')) keys.push(key); } } catch {}
      for (const key of keys.slice(0,20)) {
        let data; try { data=JSON.parse(this.storage.getItem(key)); } catch { continue; }
        if (!data?.events?.length || !data.playerId) continue;
        data.events=data.events.filter(e=>this.now()-Date.parse(e.at)<30*86400_000);
        if (!data.events.length) { this.storage.removeItem(key); continue; }
        const batch = data.events.slice(0,20);
        const geo = await this.location();
        const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),15000);
        let response;
        try { response = await this.fetch(`${this.endpoint}/api/analytics`, {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId:data.playerId,events:batch,...(geo ? {geo} : {})}),keepalive:true,signal:controller.signal}); } finally { clearTimeout(timeout); }
        if (!response.ok) continue;
        // Another request may have appended while the network was pending.
        const latest=JSON.parse(this.storage.getItem(key)||'null'); if (!latest) continue;
        const ids=new Set(batch.map(e=>e.id)); latest.events=latest.events.filter(e=>!ids.has(e.id));
        if (key===this.key) this.queue=latest.events;
        if (latest.events.length) this.storage.setItem(key,JSON.stringify(latest)); else this.storage.removeItem(key);
      }
    } catch {} finally { this.sending=false; }
  }
  tick(context, visible = true) {
    const time=this.now(), elapsed=Math.min(60,Math.max(0,(time-this.last)/1000)); this.last=time;
    if (this.context && this.wasVisible) this.pendingSeconds += elapsed;
    const changed=this.context?.gameId!==context?.gameId;
    if (this.context && (changed || !visible || this.pendingSeconds>=30)) {
      const seconds=Math.min(60,Math.floor(this.pendingSeconds)); this.pendingSeconds-=seconds;
      if (seconds) this.event('game_time',{gameId:this.context.gameId,seconds});
    }
    if (changed) { this.pendingSeconds=0; if (context) this.event('game_link',context); }
    this.context=context; this.wasVisible=visible;
  }
}
