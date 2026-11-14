import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Tabs, TabsList, TabsTrigger } from './tabs';
let root: ReturnType<typeof createRoot> | undefined;
function render(labels: string[], selected: number, change: (step: number) => void) {
  const host = document.getElementById('onboarding-progress');
  if (!host) return;
  root ??= createRoot(host);
  flushSync(() => root!.render(<Tabs value={String(selected)} onValueChange={value => change(Number(value))}>
    <TabsList variant="line" aria-label="Разделы обучения">
      {labels.map((label, index) => <TabsTrigger key={index} id={`guide-tab-${index}`} value={String(index)} aria-controls="onboarding-body">{label}</TabsTrigger>)}
    </TabsList>
  </Tabs>));
  const panel = document.getElementById('onboarding-body');
  panel?.setAttribute('role', 'tabpanel');
  panel?.setAttribute('aria-labelledby', `guide-tab-${selected}`);
}
window.gameTabs = { render };
declare global { interface Window { gameTabs: { render: typeof render } } }
