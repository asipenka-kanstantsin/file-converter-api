import type { NestExpressApplication } from '@nestjs/platform-express';

interface Layer {
  route?: { methods: Record<string, boolean>; path: string };
}

// Routes Express actually serves, as "METHOD /path/{param}" — the same shape as the spec.
export function registeredRoutes(app: NestExpressApplication): string[] {
  const instance = app.getHttpAdapter().getInstance() as {
    router: { stack: Layer[] };
  };
  return instance.router.stack.flatMap((layer) => {
    // Nest's own catch-all (`{/*splat}`) feeds the 404 handler; it is not an API route.
    if (!layer.route || layer.route.path.includes('*')) return [];
    const path = layer.route.path.replace(/:(\w+)/g, '{$1}');
    return Object.keys(layer.route.methods)
      .filter((method) => method !== '_all')
      .map((method) => `${method.toUpperCase()} ${path}`);
  });
}
