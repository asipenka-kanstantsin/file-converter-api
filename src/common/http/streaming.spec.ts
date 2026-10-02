import { Readable } from 'node:stream';

import { streamFile } from './streaming';

function fakeResponse(headersSent: boolean): Record<
  string,
  jest.Mock | boolean
> & {
  destroyed: boolean;
  headersSent: boolean;
} {
  const response = {
    destroy: jest.fn(),
    destroyed: false,
    headersSent,
    removeHeader: jest.fn(),
    send: jest.fn(),
    status: jest.fn(),
    type: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  return response;
}

describe('streamFile', () => {
  const file = streamFile(Readable.from([]), { length: 3, type: 'image/png' });

  it('answers the 500 envelope, without the raw error, before anything was sent', () => {
    const response = fakeResponse(false);

    file.errorHandler(new Error('ENOENT C:\\secret\\path'), response as never);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.removeHeader).toHaveBeenCalledWith('Content-Length');
    const body = String((response.send as jest.Mock).mock.calls[0]?.[0]);
    expect(JSON.parse(body)).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(body).not.toContain('secret');
  });

  it('aborts the connection once bytes were sent, so a truncated body is never complete', () => {
    const response = fakeResponse(true);

    file.errorHandler(new Error('reset'), response as never);

    expect(response.destroy).toHaveBeenCalled();
    expect(response.send).not.toHaveBeenCalled();
  });
});
