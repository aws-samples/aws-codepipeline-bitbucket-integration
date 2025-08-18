import { describe, it, expect } from '@jest/globals';

describe('Simple Test', () => {
  it('should pass basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should validate string operations', () => {
    const str = 'hello world';
    expect(str.toUpperCase()).toBe('HELLO WORLD');
  });

  it('should validate array operations', () => {
    const arr = [1, 2, 3];
    expect(arr.length).toBe(3);
    expect(arr.includes(2)).toBe(true);
  });
});