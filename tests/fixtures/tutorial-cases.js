import { createMoveLesson, createCombatLesson } from '../../dist/onboarding-examples.js';
export const tutorialCases = () => [
  ...[0,1,2,3].map(index=>({key:String(index),make:options=>createMoveLesson(index,options)})),
  ...['attack','defense'].map(aura=>({key:'4-'+aura,make:options=>createMoveLesson(4,{...options,aura})})),
  ...[0,1,2,3].map(index=>({key:String(index+8),make:options=>createCombatLesson(index,options)}))
];
