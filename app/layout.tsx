import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
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
  const resolved = store.get('admin_theme_resolved')?.value;
  if (resolved === 'dark' || resolved === 'light') return resolved;
  const raw = store.get('admin_theme')?.value;
  if (raw === 'dark' || raw === 'light') return raw;
  return 'light';
}

async function resolveInitialMode(): Promise<'light' | 'dark' | 'system'> {
  const store = await cookies();
  const raw = store.get('admin_theme')?.value;
  return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system';
}

const NO_FLASH = `(function(){try{var g=function(n){var x=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]+)'));return x?decodeURIComponent(x[1]):'';};var rc=g('admin_theme_resolved');var tm=g('admin_theme');var r=(rc==='dark'||rc==='light')?rc:((tm==='dark'||tm==='light')?tm:((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'));document.documentElement.setAttribute('data-theme',r);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [initialTheme, initialMode] = await Promise.all([
    resolveInitialTheme(),
    resolveInitialMode(),
  ]);
  const nonce = (await headers()).get('x-nonce') || undefined;
  return (
    <html
      lang="en"
      data-theme={initialTheme}
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
        <ThemeProvider initialMode={initialMode} initialResolved={initialTheme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
