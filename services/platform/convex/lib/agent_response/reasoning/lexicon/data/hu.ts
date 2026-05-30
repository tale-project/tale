import type { ReasoningLexicon } from '../types';

export const hu: ReasoningLexicon = {
  locale: 'hu',
  name: 'Hungarian',
  boundaryMode: 'word',
  hardVerbs: [
    'elemezd',
    'bizonyítsd',
    'optimalizáld',
    'tervezd',
    'implementáld',
    'hasonlítsd',
    'érvelj',
    'algoritmus',
  ],
  easyVerbs: [
    'fordítsd',
    'foglald össze',
    'fogalmazd át',
    'írd át',
    'rövidítsd',
    'formázd',
  ],
  trivialAcks: [
    'szia',
    'helló',
    'köszönöm',
    'kösz',
    'oké',
    'igen',
    'nem',
    'kérlek',
  ],
  creativeVerbs: ['írj', 'történet', 'vers', 'képzeld', 'találd ki', 'dal'],
  analyticalVerbs: [
    'számítsd',
    'bizonyítsd',
    'kinyerés',
    'osztályozd',
    'oldd meg',
    'ellenőrizd',
  ],
};
