import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from './_ui/theme';

// Fonts are loaded via next/font so they self-host and avoid layout shift.
// CSS variables --font-inter and --font-mono are referenced from tokens.css
// (the design-system file) — components never name the font directly.
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

/**
 * SSR-resolved theme. Reads the `admin_theme` cookie (set on login, refreshed
 * on every theme change via PATCH /api/admin/theme) and renders the matching
 * data-theme attribute on <html> directly — no client-side script, no
 * pre-paint race, no white flash on cold load even for dark-mode users.
 *
 * When the cookie is `system` or missing, we default to `light` for the
 * initial render and let the client ThemeProvider flip to dark via the
 * matchMedia listener on mount. There's no way to read the user's OS theme
 * server-side without the Sec-CH-Prefers-Color-Scheme client hint, which
 * isn't reliably present.
 */
async function resolveInitialTheme(): Promise<'light' | 'dark'> {
  const store = await cookies();
  const raw = store.get('admin_theme')?.value;
  if (raw === 'dark' || raw === 'light') return raw;
  return 'light';
}

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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
