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
  // The client persists the actual resolved light/dark value here so the
  // server renders the correct theme even for 'system' mode (it can't
  // read prefers-color-scheme). This is the no-flash source of truth.
  const resolved = store.get('admin_theme_resolved')?.value;
  if (resolved === 'dark' || resolved === 'light') return resolved;
  const raw = store.get('admin_theme')?.value;
  if (raw === 'dark' || raw === 'light') return raw;
  return 'light';
}

// Belt-and-suspenders: corrects data-theme before first paint on the
// very first visit (no resolved cookie yet) using the OS preference.
const NO_FLASH = `(function(){try{
var rc=(document.cookie.match(/(?:^|; )admin_theme_resolved=([^;]+)/)||[])[1];
if(rc==='dark'||rc==='light'){document.documentElement.setAttribute('data-theme',rc);return;}
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
      <body>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
