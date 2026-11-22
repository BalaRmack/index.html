import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nocturne — музыка для ваших моментов',
  description: 'Музыка для каждого момента.',
  applicationName: 'Nocturne',
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }], apple: '/icons/icon-180.png' },
  appleWebApp: { capable: true, title: 'Nocturne', statusBarStyle: 'black-translucent', startupImage: '/icons/icon-512.png' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0d100f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark',
};

const BOOTSTRAP = `(function(){try{
  var raw=localStorage.getItem('nocturne.preferences.v1');if(!raw)return;
  var p=JSON.parse(raw);var root=document.documentElement;
  var accents={
    nocturne:['#b7e49a','#8fcf7f','#12200f','#111a13','rgba(183,228,154,.22)'],
                    violet:['#c9b6ff','#a68cff','#181226','#140e24','rgba(201,182,255,.22)'],
                    amber:['#f7d199','#f0b46a','#21190f','#1f1508','rgba(247,209,153,.22)'],
                    ice:['#a9d8ff','#7fc0ff','#101b24','#0c1924','rgba(169,216,255,.22)']
  };
  var a=accents[p.accent]||accents.nocturne;
  root.style.setProperty('--green',a[0]);
  root.style.setProperty('--green-strong',a[1]);
  root.style.setProperty('--green-deep',a[2]);
  root.style.setProperty('--green-ink',a[3]);
  root.style.setProperty('--green-glow',a[4]);
  root.dataset.accent=p.accent||'nocturne';
if(p.glass)root.dataset.glass=p.glass;
if(p.particles)root.dataset.particles=p.particles;
if(p.sidebar)root.dataset.sidebar=p.sidebar;
if(p.playerStyle)root.dataset.player=p.playerStyle;
if(p.nowPlaying)root.dataset.nowplaying=p.nowPlaying;
if(p.language)root.lang=p.language;
}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" data-accent="nocturne" data-glass="full" data-player="attached" suppressHydrationWarning>
    <body>
    <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: 'absolute', overflow: 'hidden' }}>
    <defs>
    <filter id="liquid-glass-refraction" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
    <feImage href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%20viewBox%3D%220%200%20100%20100%22%20preserveAspectRatio%3D%22none%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22l%22%3E%3Cstop%20stop-color%3D%22rgb%280%2C128%2C128%29%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22rgb%28128%2C128%2C128%29%22%2F%3E%3C%2FlinearGradient%3E%3ClinearGradient%20id%3D%22r%22%3E%3Cstop%20stop-color%3D%22rgb%28128%2C128%2C128%29%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22rgb%28255%2C128%2C128%29%22%2F%3E%3C%2FlinearGradient%3E%3ClinearGradient%20id%3D%22t%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20stop-color%3D%22rgb%28128%2C0%2C128%29%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22rgb%28128%2C128%2C128%29%22%2F%3E%3C%2FlinearGradient%3E%3ClinearGradient%20id%3D%22b%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20stop-color%3D%22rgb%28128%2C128%2C128%29%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22rgb%28128%2C255%2C128%29%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20fill%3D%22rgb%28128%2C128%2C128%29%22%2F%3E%3Crect%20width%3D%228%22%20height%3D%22100%22%20fill%3D%22url%28%23l%29%22%2F%3E%3Crect%20x%3D%2292%22%20width%3D%228%22%20height%3D%22100%22%20fill%3D%22url%28%23r%29%22%2F%3E%3Crect%20x%3D%228%22%20width%3D%2284%22%20height%3D%228%22%20fill%3D%22url%28%23t%29%22%2F%3E%3Crect%20x%3D%228%22%20y%3D%2292%22%20width%3D%2284%22%20height%3D%228%22%20fill%3D%22url%28%23b%29%22%2F%3E%3C%2Fsvg%3E" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="lens" />
    <feDisplacementMap in="SourceGraphic" in2="lens" scale="8" xChannelSelector="R" yChannelSelector="G" result="redShift" />
    <feDisplacementMap in="SourceGraphic" in2="lens" scale="10" xChannelSelector="R" yChannelSelector="G" result="greenShift" />
    <feDisplacementMap in="SourceGraphic" in2="lens" scale="12" xChannelSelector="R" yChannelSelector="G" result="blueShift" />
    <feColorMatrix in="redShift" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
    <feColorMatrix in="greenShift" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
    <feColorMatrix in="blueShift" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
    <feBlend in="r" in2="g" mode="screen" result="rg" />
    <feBlend in="rg" in2="b" mode="screen" />
    </filter>
    <filter id="liquid-glass-light" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="edge" />
    <feSpecularLighting in="edge" surfaceScale="2" specularConstant="0.6" specularExponent="20" lightingColor="#e9fff1" result="light">
    <fePointLight x="0" y="-20" z="60" />
    </feSpecularLighting>
    <feComposite in="light" in2="SourceAlpha" operator="in" />
    </filter>
    </defs>
    </svg>
    {children}
    </body>
    </html>
  );
}
