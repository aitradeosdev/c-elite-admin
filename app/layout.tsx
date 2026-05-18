import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from './_ui/theme';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'CardElite Admin',
  description: 'CardElite Admin Panel',
};

async function resolveInitialTheme(): Promise<'light' | 'dark'> {
  const store = await cookies();
  const raw = store.get('admin_theme')?.value;
  if (raw === 'dark' || raw === 'light') return raw;
  return 'light';
}

// Runs synchronously before first paint — resolves the real theme from
// the cookie (or the OS for 'system'/unset) and sets data-theme so the
// page never flashes light on refresh. The server's data-theme below is
// only a best-guess fallback; this script is authoritative.
const NO_FLASH = `(function(){try{
var m=(document.cookie.match(/(?:^|; )admin_theme=([^;]+)/)||[])[1];
m=m?decodeURIComponent(m):'system';
var r=(m==='dark'||m==='light')?m:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
document.documentElement.setAttribute('data-theme',r);
}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialTheme = await resolveInitialTheme();
  return (
    <html
      lang="en"
      data-theme={initialTheme}
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
