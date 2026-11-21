import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Nocturne — music for your moments', description: 'A little more room for music.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
