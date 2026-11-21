import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Nocturne — музыка для ваших моментов', description: 'Музыка для каждого момента.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{position:'absolute',overflow:'hidden'}}>
      <defs>
        <filter id="liquid-glass-refraction" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.045" numOctaves="2" seed="8" result="ripples" />
          <feDisplacementMap in="SourceGraphic" in2="ripples" scale="7" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="liquid-glass-light" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="edge" />
          <feSpecularLighting in="edge" surfaceScale="2" specularConstant="0.6" specularExponent="20" lightingColor="#e9fff1" result="light"><fePointLight x="0" y="-20" z="60" /></feSpecularLighting>
          <feComposite in="light" in2="SourceAlpha" operator="in" />
        </filter>
      </defs>
    </svg>
    {children}
  </body></html>;
}
