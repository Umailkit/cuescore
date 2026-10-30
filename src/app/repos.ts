import { createRepositories } from '@data/index';

/**
 * Application-wide composition root for persistence. Import this (not the
 * concrete IndexedDB classes) anywhere in the app or UI needs storage, so the
 * backing store can be swapped without touching call sites.
 */
export const repos = createRepositories();
