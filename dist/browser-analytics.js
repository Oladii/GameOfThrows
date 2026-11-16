import { ArchiveIndexedDBStorage } from './game-archive.js';

// A separate bounded queue keeps analytics failures out of game state and controls.
export class BrowserAnalytics {
  constructor({ enabled = false, endpoint = '', storage = null, identity = new ArchiveIndexedDBStorage(globalThis.indexedDB), fetch = globalThis.fetch?.bind(globalThis), uuid = () => crypto.randomUUID(), now = () => Date.now() } = {}) {
    this.enabled = enabled; this.endpoint = endpoint; this.storage = storage;
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
        const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),15000);
        let response;
        try { response = await this.fetch(`${this.endpoint}/api/analytics`, {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId:data.playerId,events:batch}),keepalive:true,signal:controller.signal}); } finally { clearTimeout(timeout); }
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
