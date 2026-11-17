// Pointer gestures only. The application owns selection, legal moves and history.
export class BoardDrag {
  constructor({ board, canStart, start, canDrop, drop, preview = () => {}, finish = () => {} }) {
    Object.assign(this, { board, canStart, start, canDrop, drop, preview, finish });
    this.doc = board.ownerDocument;
    this.win = this.doc.defaultView;
    this.listeners = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      this.listeners.push(() => target.removeEventListener(type, handler, options));
    };
    listen(this.doc, 'pointerdown', event => this.pointerDown(event), true);
    listen(this.win, 'pointermove', event => this.pointerMove(event), { passive: false });
    listen(this.win, 'pointerup', event => this.pointerUp(event));
    listen(this.win, 'pointercancel', event => { if (event.pointerId === this.gesture?.pointerId) this.cancel(); });
    listen(board, 'lostpointercapture', event => { if (event.pointerId === this.gesture?.pointerId) this.cancel(); });
    for (const type of ['blur', 'pagehide', 'resize']) listen(this.win, type, () => this.cancel());
    listen(this.doc, 'visibilitychange', () => { if (this.doc.hidden) this.cancel(); });
    listen(this.doc, 'keydown', event => { if (event.key === 'Escape' && this.gesture) this.cancel(); }, true);
    listen(this.doc, 'click', event => {
      if (this.suppressClick && event.detail !== 0) {
        this.suppressClick = false;
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    listen(board, 'dragstart', event => event.preventDefault());
    this.refresh();
  }
  get active() { return Boolean(this.gesture?.token); }
  refresh() {
    for (const cell of this.board.querySelectorAll('[data-cell]')) {
      cell.classList.toggle('draggable', Boolean(this.canStart(cell.dataset.cell)));
    }
  }
  cellAt(event) {
    const cell = this.doc.elementFromPoint(event.clientX, event.clientY)?.closest('[data-cell]');
    return cell && this.board.contains(cell) ? cell : null;
  }
  pointerDown(event) {
    if (this.gesture) return; // A second pointer never takes over a gesture.
    this.suppressClick = false;
    if (event.button !== 0 || event.isPrimary === false) return;
    const cell = event.target.closest('[data-cell]');
    if (!cell || !this.board.contains(cell)) return;
    const piece = this.canStart(cell.dataset.cell);
    if (!piece) return;
    this.gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, piece };
  }
  pointerMove(event) {
    let gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!gesture.token) {
      const threshold = event.pointerType === 'touch' ? 10 : 6;
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < threshold) return;
      // Selection renders the board. Keep this candidate out of render's cleanup.
      this.gesture = null;
      const source = this.start(gesture.piece);
      if (!source) return;
      gesture.source = source;
      gesture.token = source.cloneNode(true);
      gesture.token.removeAttribute('data-piece-id');
      gesture.token.classList.remove('preview-origin');
      gesture.token.classList.add('drag-token');
      gesture.transform = source.getAttribute('transform') || '';
      gesture.token.setAttribute('aria-hidden', 'true');
      this.board.append(gesture.token);
      source.classList.add('drag-origin');
      this.gesture = gesture;
      this.board.classList.add('is-dragging');
      this.board.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    const matrix = this.board.getScreenCTM();
    if (!matrix) { this.cancel(); return; }
    const point = this.board.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const current = point.matrixTransform(matrix.inverse());
    point.x = gesture.x; point.y = gesture.y;
    const origin = point.matrixTransform(matrix.inverse());
    gesture.token.setAttribute('transform', `translate(${current.x - origin.x},${current.y - origin.y}) ${gesture.transform}`);
    gesture.target?.classList.remove('drag-target');
    const cell = this.cellAt(event);
    gesture.target = cell && this.canDrop(gesture.piece, cell.dataset.cell) ? cell : null;
    gesture.target?.classList.add('drag-target');
    const cellKey = gesture.target?.dataset.cell || null;
    if (cellKey !== gesture.previewCell) {
      gesture.previewCell = cellKey;
      this.preview(gesture.piece, cellKey, gesture.token);
    }
  }
  pointerUp(event) {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const cell = gesture.token && this.cellAt(event);
    const destination = cell && this.canDrop(gesture.piece, cell.dataset.cell) ? cell.dataset.cell : null;
    this.cancel();
    if (destination) this.drop(gesture.piece, destination);
  }
  cancel() {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    if (gesture.token) {
      this.suppressClick = true;
      gesture.token.remove();
      gesture.source.classList.remove('drag-origin');
      gesture.target?.classList.remove('drag-target');
      this.board.classList.remove('is-dragging');
      if (this.board.hasPointerCapture?.(gesture.pointerId)) this.board.releasePointerCapture(gesture.pointerId);
      this.finish();
    }
  }
  destroy() { this.cancel(); for (const remove of this.listeners) remove(); }
}
