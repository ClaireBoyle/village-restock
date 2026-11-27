import { describe, expect, it } from 'vitest';
import { shortenUnder } from './prep';

describe('shortenUnder: under a heading, each job says only what is different', () => {
  it('drops the shared verb and phrase the heading already says', () => {
    expect(shortenUnder('Cut veg for Harvest Hommus', ['Cut carrots for Harvest Hommus', 'Cut cucumber for Harvest Hommus', 'Cut radish for Harvest Hommus']))
      .toEqual(['Carrots', 'Cucumber', 'Radish']);
    expect(shortenUnder('Make sauces', ['Make vodka sauce', 'Make tartare'])).toEqual(['Vodka sauce', 'Tartare']);
    expect(shortenUnder('Portion proteins', ['Portion defrosted pulled beef'])).toEqual(['Defrosted pulled beef']);
  });
  it('keeps the full name when the heading does not say it, or the jobs differ', () => {
    expect(shortenUnder('Seasonings', ['Make signature chip salt', 'Make GC seasoning'])).toEqual(['Make signature chip salt', 'Make GC seasoning']);
    expect(shortenUnder('Salad bar', ['Dice tomato', 'Slice cucumber for bao buns'])).toEqual(['Dice tomato', 'Slice cucumber for bao buns']);
    expect(shortenUnder('Dessert prep', ['Make raspberry compote', 'Portion chocolate sauce'])).toEqual(['Make raspberry compote', 'Portion chocolate sauce']);
  });
  it('never leaves a job with no name', () => {
    expect(shortenUnder('Make sauces', ['Make sauces', 'Make sauces']).every((n) => n.length > 0)).toBe(true);
    expect(shortenUnder('Portion', ['Portion'])).toEqual(['Portion']);
  });
});
