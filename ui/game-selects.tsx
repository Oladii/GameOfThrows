import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './select';

// Keep the game's native controls as the source of truth for events and FormData.
const controls = new Map<HTMLSelectElement, { root: ReturnType<typeof createRoot>; host: HTMLElement; label: string }>();
function sync() {
  for (const [native, { root, label }] of controls) {
    root.render(<Select value={native.value} disabled={native.disabled} onValueChange={value => {
      native.value = value;
      native.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    }}>
      <SelectTrigger id={`${native.id || native.name}-trigger`} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent container={native.closest('dialog')!} position="popper" align="start" sideOffset={5}>
        {Array.from(native.options).map(option => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.text}</SelectItem>)}
      </SelectContent>
    </Select>);
  }
}
function mount() {
  document.querySelectorAll<HTMLSelectElement>('#start-dialog select, #settings-dialog select').forEach(native => {
    if (controls.has(native)) return;
    const label = Array.from(native.labels || []).map(item => {
      const copy = item.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('select').forEach(select => select.remove());
      return copy.textContent?.trim();
    }).join(' ') || native.name;
    const host = document.createElement('span');
    host.className = 'game-select';
    native.after(host);
    controls.set(native, { root: createRoot(host), host, label });
    for (const item of Array.from(native.labels || [])) if (item.htmlFor) item.htmlFor = `${native.id}-trigger`;
    native.hidden = true;
    native.addEventListener('change', sync);
  });
  flushSync(sync);
}
window.gameSelects = { mount, sync };
declare global { interface Window { gameSelects: { mount: typeof mount; sync: typeof sync } } }

import './game-tabs';
