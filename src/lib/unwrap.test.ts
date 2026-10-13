import { describe, expect, it } from 'vitest';
import { unwrap } from './unwrap';

describe('unwrap', () => {
  it('returns data when there is no error', () => {
    expect(unwrap({ data: [1, 2], error: null })).toEqual([1, 2]);
  });

  it('returns null data as-is when there is no error', () => {
    expect(unwrap({ data: null, error: null })).toBeNull();
  });

  it('rethrows Error instances unchanged', () => {
    const err = new Error('RLS denied');
    expect(() => unwrap({ data: null, error: err })).toThrow(err);
  });

  it('wraps plain error objects in an Error, keeping their fields', () => {
    try {
      unwrap({ data: null, error: { message: 'boom', code: '42501' } });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBe('boom');
      expect((e as { code?: string }).code).toBe('42501');
    }
  });
});
