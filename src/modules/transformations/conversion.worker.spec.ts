import run from './conversion.worker';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

// The worker thread reports no coverage of its own, so the layer that turns a converter's
// exception into data the main thread can read is exercised here.
describe('conversion worker', () => {
  it('hands a successful conversion back as transferable bytes, not as a failure', async () => {
    const result = await run({
      input: enc('{"a":1}'),
      kind: 'text',
      source: 'json',
      target: 'yaml',
    });

    // Piscina.move wraps the bytes for the thread boundary; the pool unwraps them on the other
    // side. What matters here is that it is the success shape, not a failure envelope.
    expect(result).not.toMatchObject({ ok: false });
  });

  it('turns a conversion failure into a code instead of an exception', async () => {
    const result = await run({
      input: enc('{not json'),
      kind: 'text',
      source: 'json',
      target: 'yaml',
    });

    expect(result).toEqual({ code: 'FILE_PARSE_ERROR', ok: false });
  });

  it('reports a structure too deep rather than crashing the thread', async () => {
    // Deep enough for the parser to give up; either way the caller gets a code, not a crash.
    const deep = `${'['.repeat(200)}1${']'.repeat(200)}`;
    const result = await run({
      input: enc(deep),
      kind: 'text',
      source: 'json',
      target: 'json',
    });

    expect(result).toMatchObject({ ok: false });
  });

  it('reports a raster failure as a code with its context', async () => {
    const result = (await run({
      background: '#ffffff',
      input: enc('not an image'),
      kind: 'raster',
      quality: 85,
      target: 'png',
      timeoutMs: 5_000,
    })) as { code: string; ok: false };

    expect(result.ok).toBe(false);
    expect(typeof result.code).toBe('string');
  });
});
