import type { MetadataRoute } from 'next';

// Lets staff add the app to the iPad/phone home screen. It then opens full
// screen like a normal app, and the service worker (public/sw.js) lets it open
// without a connection.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Village Restock',
    short_name: 'Restock',
    description: 'Guided restocking for cinema staff.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F7F8FB',
    theme_color: '#101C55',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
