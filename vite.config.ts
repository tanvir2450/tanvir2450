import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    // The Arena browser preview uses a dynamically generated hostname.
    allowedHosts: true,
  },
  preview: { host: '0.0.0.0', allowedHosts: true },
});
