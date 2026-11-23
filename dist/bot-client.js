export const DEFAULT_BOT_DIFFICULTY = 'training';
export const BOT_DIFFICULTIES = Object.freeze({
  training: Object.freeze({ label: 'Неопытный', depth: 2, forgiving: true }),
  easy: Object.freeze({ label: 'Опытный', depth: 2 }),
  hard: Object.freeze({ label: 'Воевода', depth: 4 })
});
export function readBotDifficulty(value) { return typeof value === 'string' && Object.hasOwn(BOT_DIFFICULTIES, value) ? value : DEFAULT_BOT_DIFFICULTY; }

export function createBotWorker() {
  const embedded = document.querySelector('#bot-worker-source');
  if (!embedded) return new Worker(new URL('./bot-worker.js', import.meta.url), { type: 'module' });
  const url = URL.createObjectURL(new Blob([JSON.parse(embedded.textContent)], { type: 'text/javascript' }));
  // The embedded bundle has no imports. A classic Worker also works when the
  // standalone page has a file: origin. Keep its Blob alive until cancellation.
  try {
    const worker = new Worker(url);
    const terminate = worker.terminate.bind(worker);
    let released = false;
    worker.terminate = () => {
      try { terminate(); }
      finally {
        if (!released) { released = true; URL.revokeObjectURL(url); }
      }
    };
    return worker;
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

// Every request owns its worker. Cancellation also rejects late results.
export class BotRunner {
  constructor(factory = createBotWorker, timeoutMs = 45000) {
    this.factory = factory; this.timeoutMs = timeoutMs; this.serial = 0; this.worker = null; this.timer = null;
  }
  get active() { return this.worker !== null; }
  cancel() {
    clearTimeout(this.timer); this.timer = null;
    if (this.worker) this.worker.terminate();
    this.worker = null; this.serial++;
  }
  run(request, onResult, onError) {
    this.cancel();
    const id = this.serial;
    try {
      const worker = this.factory(); this.worker = worker;
      const finish = (callback, value) => {
        if (this.worker !== worker || this.serial !== id) return;
        this.cancel(); callback(value);
      };
      worker.onmessage = event => {
        if (event.data?.id !== id) return;
        if (event.data.error) finish(onError, new Error(event.data.error));
        else finish(onResult, event.data.result);
      };
      worker.onerror = event => { event.preventDefault?.(); finish(onError, new Error('Не удалось рассчитать ход бота')); };
      worker.onmessageerror = () => finish(onError, new Error('Не удалось прочитать ответ бота'));
      this.timer = setTimeout(() => finish(onError, new Error('Бот не успел рассчитать ход. Попробуй ещё раз')), this.timeoutMs);
      worker.postMessage({ ...request, id });
    } catch (error) { this.cancel(); onError(error); }
  }
}
