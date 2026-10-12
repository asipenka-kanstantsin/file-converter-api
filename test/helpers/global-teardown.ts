export default async function globalTeardown(): Promise<void> {
  const infra = globalThis.__E2E_INFRA__;
  if (!infra) return;
  // Absent when globalSetup failed before the sink started.
  await infra.mail?.stop();
  // Non-persistent: this also removes the embedded cluster's data directory. A no-op when the
  // run used an already-running server.
  await infra.database.stop();
}
