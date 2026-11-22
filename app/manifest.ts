import type { MetadataRoute } from 'next';

/** PWA: приложение устанавливается на iOS и Android и запускается в полноэкранном режиме. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nocturne — музыка для ваших моментов',
    short_name: 'Nocturne',
    description: 'Локальная фонотека, «Моя волна» и подборки из ваших прослушиваний.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#0d100f',
    theme_color: '#0d100f',
    lang: 'ru',
    dir: 'ltr',
    categories: ['music', 'entertainment'],
    shortcuts: [
      { name: 'Моя волна', short_name: 'Волна', url: '/?view=wave', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Понравившиеся', short_name: 'Лайки', url: '/?view=liked', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
