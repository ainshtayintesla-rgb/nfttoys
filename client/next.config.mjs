const securityHeaders = [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  // X-Frame-Options removed to allow embedding in Telegram Mini App (iframe)
  // Security is handled by Content-Security-Policy frame-ancestors instead
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    // Allow camera for QR scanner, keep others disabled
    value: 'camera=(self), microphone=(), geolocation=()',
  },
];

const nextConfig = {
  // Disable x-powered-by header to hide Next.js
  poweredByHeader: false,

  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
