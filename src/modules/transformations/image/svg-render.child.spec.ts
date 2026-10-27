import sharp from 'sharp';

import { render, type SvgRenderJob } from './svg-render.child';

function job(svg: string, overrides: Partial<SvgRenderJob> = {}): SvgRenderJob {
  return {
    background: '#ffffff',
    input: new TextEncoder().encode(svg),
    maxHeight: 4096,
    maxWidth: 4096,
    quality: 85,
    target: 'png',
    ...overrides,
  };
}

// The child process never reports its own coverage, so the render itself is exercised here; the
// process plumbing around it is covered by the SVG e2e suite.
describe('svg render child', () => {
  it('renders a document at the requested size', async () => {
    const output = await render(
      job('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', {
        width: 64,
      }),
    );

    const meta = await sharp(Buffer.from(output)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 64, 64]);
  });

  it('refuses a document whose declared size would paint far more than it returns', async () => {
    // 1e7 units wide: the density floor of 1 makes librsvg paint ~139k px a side for a 64 px
    // request. The output size check alone lets it through.
    const huge = job(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1e7" height="1e7"/>',
      { width: 64 },
    );

    await expect(render(huge)).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
    });
  });

  it('refuses an output larger than the configured maximum', async () => {
    await expect(
      render(
        job(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
          {
            width: 8192,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
  });

  it('reports an unsafe document and a broken one apart', async () => {
    await expect(
      render(job('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>')),
    ).rejects.toMatchObject({ code: 'SVG_UNSAFE' });
    await expect(render(job('<svg><unclosed'))).rejects.toMatchObject({
      code: 'FILE_PARSE_ERROR',
    });
  });
});
