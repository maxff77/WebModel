import { describe, it, expect } from 'vitest';
import { deepseekClientHeaders, pickClientHeaders } from '../../../src/providers/deepseek/client.js';

describe('deepseekClientHeaders', () => {
  it('replicates the web client identity headers', () => {
    const headers = deepseekClientHeaders('device-1');

    expect(headers).toMatchObject({
      'x-client-platform': 'web',
      'x-client-version': '2.5.0',
      'x-client-locale': 'en_US',
      'x-client-bundle-id': 'com.deepseek.chat',
      'x-device-model': '',
      'x-device-id': 'device-1',
    });
    expect(headers['x-client-timezone-offset']).toMatch(/^-?\d+$/);
  });

  it('omits x-device-id when the page has none', () => {
    expect(deepseekClientHeaders(null)).not.toHaveProperty('x-device-id');
  });

  it('picks only identity headers from a captured request', () => {
    expect(pickClientHeaders({
      'x-client-version': '9.9',
      'x-device-id': 'device-2',
      authorization: 'Bearer secret',
      'user-agent': 'captured',
    })).toEqual({ 'x-client-version': '9.9', 'x-device-id': 'device-2' });
  });
});
