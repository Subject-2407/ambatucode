// `server-only` throws unless resolved under the react-server condition, which
// Vitest does not provide. Modules under src/server are exercised directly in
// tests, so the marker is aliased to this no-op.
export {};
