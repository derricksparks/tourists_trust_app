const API_URL = process.env.API_URL ?? 'http://localhost:3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    // Browser-side calls (badge script, Mini App) go to /backend/* on this site and are proxied to the API,
    // so the API never needs to be exposed on a second public hostname. The target is fixed when the site is
    // built (API_URL at build time; the Dockerfile sets the API container's address).
    return [{ source: '/backend/:path*', destination: `${API_URL}/:path*` }];
  },
  async headers() {
    return [
      // The badge script is loaded by operators' own websites.
      { source: '/badge.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }, { key: 'Access-Control-Allow-Origin', value: '*' }] },
      // The iframe badge must be embeddable anywhere; everything else must not be framed.
      { source: '/badge/:token', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors *" }] },
      // Telegram's web clients open the Mini App in an iframe.
      { source: '/tg/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org" }] },
      { source: '/((?!badge/|tg).*)', headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] },
    ];
  },
};

export default nextConfig;
