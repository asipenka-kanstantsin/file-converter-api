import { createHash } from 'node:crypto';

// Pinned to one release, with the subresource hashes of exactly those two files: a compromised
// or re-tagged CDN build is refused by the browser instead of running on the API's own origin,
// where it could read csrf_token and act as whoever is signed in. The hashes come from the npm
// tarball of this version (`npm pack swagger-ui-dist@5.34.0`); bump all three together.
const SWAGGER_UI_VERSION = '5.34.0';
const SWAGGER_UI_CDN = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}`;
const SWAGGER_UI_SCRIPT_SRI =
  'sha384-9Td7MKiIr2S83E1kZyyVi8KdJw/S8CpAvu0llLyMeg0xq/hDGiZJfVn0fV4llCmK';
const SWAGGER_UI_STYLE_SRI =
  'sha384-4c3vsE5f+trhFyHrFrLM1fFGUn531NIaC7dcqEWIJdoRQJ5CkJbSuSCwXLpaS1KF';

// Echoes the csrf_token cookie into X-CSRF-Token so "Try it out" passes the
// double-submit check once GET /api/auth/csrf (or login) has set the cookie.
const INIT_SCRIPT = `
window.ui = SwaggerUIBundle({
  dom_id: '#swagger-ui',
  persistAuthorization: true,
  requestInterceptor: (req) => {
    const match = document.cookie.match(/(?:^|;\\s*)csrf_token=([^;]+)/);
    if (match) req.headers['X-CSRF-Token'] = decodeURIComponent(match[1]);
    req.credentials = 'same-origin';
    return req;
  },
  tryItOutEnabled: true,
  url: '/api/openapi.json',
  withCredentials: true,
});
`;

const scriptHash = createHash('sha256').update(INIT_SCRIPT).digest('base64');

export const DOCS_PAGE_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  `img-src 'self' data: ${SWAGGER_UI_CDN}/`,
  `script-src ${SWAGGER_UI_CDN}/ 'sha256-${scriptHash}'`,
  `style-src ${SWAGGER_UI_CDN}/ 'unsafe-inline'`,
].join('; ');

export const DOCS_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>File Converter API</title>
<link rel="stylesheet" href="${SWAGGER_UI_CDN}/swagger-ui.css" integrity="${SWAGGER_UI_STYLE_SRI}" crossorigin="anonymous">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${SWAGGER_UI_CDN}/swagger-ui-bundle.js" integrity="${SWAGGER_UI_SCRIPT_SRI}" crossorigin="anonymous"></script>
<script>${INIT_SCRIPT}</script>
</body>
</html>
`;
