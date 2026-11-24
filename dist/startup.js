(() => {
  const root = document.documentElement;
  const screen = document.querySelector('#startup-screen');
  const logo = screen.querySelector('img');
  const callbacks = [];
  let loading = true;
  let canShow = false;
  let minimumDisplay;

  function revealGame() {
    if (!screen.hidden) screen.hidden = true;
    delete root.dataset.gameStartup;
    delete window.gameStartup;
    for (const callback of callbacks) callback();
  }

  function finish() {
    if (!loading) return;
    loading = false;
    clearTimeout(displayDelay);
    if (minimumDisplay) void minimumDisplay.then(revealGame);
    else revealGame();
  }

  function tryShowingLogo() {
    requestAnimationFrame(() => {
      if (!loading || !canShow || !screen.hidden || !logo.complete || !logo.naturalWidth) return;
      screen.hidden = false;
      root.dataset.gameStartup = 'visible';
      minimumDisplay = new Promise(resolve => {
        // Begin the hold after the frame in which the logo first appeared.
        requestAnimationFrame(() => setTimeout(resolve, 1000));
      });
    });
  }

  function pendingImage(image) {
    if (!image || image.complete) return null;
    return new Promise(resolve => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }

  root.dataset.gameStartup = 'pending';
  // Let cached resources and synchronous setup settle without a flash.
  const displayDelay = setTimeout(() => { canShow = true; tryShowingLogo(); }, 120);
  window.gameStartup = {
    whenReady(callback) { callbacks.push(callback); },
    complete(firstScreenLogo, artwork) {
      const pending = [pendingImage(firstScreenLogo)];
      for (const url of new Set(artwork)) {
        if (!url || url.startsWith('data:')) continue;
        const image = new Image();
        image.src = url;
        pending.push(pendingImage(image));
      }
      const waits = pending.filter(Boolean);
      if (waits.length) void Promise.all(waits).then(finish);
      else finish();
    }
  };
  logo.addEventListener('load', tryShowingLogo, { once: true });
})();
