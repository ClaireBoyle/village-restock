import { describe, expect, it } from 'vitest';
import { prepKind, type PrepGroup } from './prep';

// The Gold Class Kitchen tasks as they are live, by kind on the Kitchen screen's Morning prep.
const live: [string, PrepGroup][] = [
  ['Cut carrots for Harvest Hommus', 'vegetables'], ['Cut cucumber for Harvest Hommus', 'vegetables'], ['Cut celery for Harvest Hommus', 'vegetables'],
  ['Cut radish for Harvest Hommus', 'vegetables'], ['Portion defrosted pulled beef', 'proteins'], ['Portion BBQ sauce', 'sauces'], ['Portion sweet chilli sauce', 'sauces'],
  ['Portion tomato sauce', 'sauces'], ['Make vodka sauce', 'sauces'], ['Make sriracha mayo', 'sauces'], ['Make burger sauce', 'sauces'], ['Make hollandaise dressing', 'sauces'],
  ['Make tartare', 'sauces'], ['Make maple aioli', 'sauces'], ['Make sesame mayo', 'sauces'], ['Portion lamb', 'proteins'], ['Portion cauliflower popcorn', 'vegetables'],
  ["Portion Fisherman's Baskets", 'proteins'], ['Make smoky sauerkraut aioli', 'sauces'], ['Make sesame XO dumpling sauce', 'sauces'], ['Make raspberry compote', 'other'],
  ['Make signature chip salt', 'other'], ['Dice white onion for burgers', 'vegetables'], ['Slice cucumber for bao buns', 'vegetables'], ['Dice tomato', 'vegetables'],
  ['Wash tubs of lettuce', 'vegetables'], ['Cut and shred lettuce', 'vegetables'], ['Cut lemon wedges', 'other'], ['Cut lime wedges', 'other'], ['Dice red onion', 'vegetables'],
  ['Portion smokey tomato relish', 'sauces'], ['Make GC seasoning', 'other'], ['Portion chocolate sauce', 'sauces'], ['Portion pizza cheese into bags and freeze', 'other'],
];

describe('Morning prep by kind of job', () => {
  const by = (k: string) => live.filter(([name, group]) => prepKind({ name, group }) === k).map(([n]) => n);
  it('Portioning: proteins, cauliflower popcorn, pizza cheese (not the sauces)', () => {
    expect(by('portion')).toEqual(['Portion defrosted pulled beef', 'Portion lamb', 'Portion cauliflower popcorn', "Portion Fisherman's Baskets", 'Portion pizza cheese into bags and freeze']);
  });
  it('Cutting: cut, dice, slice, shred and wash', () => {
    expect(by('cut')).toEqual(['Cut carrots for Harvest Hommus', 'Cut cucumber for Harvest Hommus', 'Cut celery for Harvest Hommus', 'Cut radish for Harvest Hommus',
      'Dice white onion for burgers', 'Slice cucumber for bao buns', 'Dice tomato', 'Wash tubs of lettuce', 'Cut and shred lettuce', 'Cut lemon wedges', 'Cut lime wedges', 'Dice red onion']);
  });
  it('Sauces: every sauce job, made or portioned', () => {
    expect(by('sauce')).toHaveLength(14);
    expect(by('sauce')).toContain('Portion BBQ sauce');
    expect(by('sauce')).toContain('Make tartare');
  });
  it('Other: the rest (compote, chip salt, GC seasoning), and typed-in jobs', () => {
    expect(by('other')).toEqual(['Make raspberry compote', 'Make signature chip salt', 'Make GC seasoning']);
    expect(prepKind({ name: 'Clean the slicer', group: 'other' })).toBe('other');
  });
});
