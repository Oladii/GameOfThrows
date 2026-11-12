import { TYPES } from '../../dist/rules.js';
import { createMoveLesson, createCombatLesson } from '../../dist/onboarding-examples.js';
import { createUnitLesson } from '../../dist/onboarding-units.js';
export const tutorialCases = () => [
  ...[0,1,2,3].map(index=>({key:String(index),make:options=>createMoveLesson(index,options)})),
  ...['attack','defense'].map(aura=>({key:'4-'+aura,make:options=>createMoveLesson(4,{...options,aura})})),
  ...TYPES.map(type=>({key:'unit-'+type,make:options=>createUnitLesson(type,options)})),
  ...[0,1,2,3].map(index=>({key:String(index+8),make:options=>createCombatLesson(index,options)}))
];
