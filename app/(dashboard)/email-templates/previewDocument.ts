export interface PreviewDocumentOptions {
  remoteImages: boolean;
}

const BASE_STYLE = ':root{color-scheme:light;background:Canvas;color:CanvasText}img{max-width:100%;height:auto}';

const REMOTE_ATTRIBUTE = /\b(?:src|srcset|background|poster)\s*=\s*["']?\s*(?:https?:)?\/\//gi;
const REMOTE_CSS = /url\(\s*["']?\s*(?:https?:)?\/\//gi;
const LINK_TAG = /<(?:a|area|form)\b[^>]*>/gi;
const TARGET_ATTRIBUTE = /\s+target\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

export function previewPolicy(remoteImages: boolean): string {
  const sources = remoteImages ? 'data: https:' : 'data:';
  return [
    "default-src 'none'",
    `img-src ${sources}`,
    `font-src ${sources}`,
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export function withoutLinkTargets(html: string): string {
  return html.replace(LINK_TAG, (tag) => tag.replace(TARGET_ATTRIBUTE, ''));
}

export function previewDocument(html: string, options: PreviewDocumentOptions): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${previewPolicy(options.remoteImages)}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="color-scheme" content="light">',
    '<base target="_blank">',
    `<style>${BASE_STYLE}</style>`,
    '</head><body>',
    withoutLinkTargets(html),
    '</body></html>',
  ].join('');
}

export function plainTextOf(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function remoteReferenceCount(html: string): number {
  return (html.match(REMOTE_ATTRIBUTE)?.length ?? 0) + (html.match(REMOTE_CSS)?.length ?? 0);
}

export function pickSamples(
  samples: Readonly<Record<string, string>>,
  variables: readonly string[],
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of variables) picked[name] = samples[name] ?? '';
  return picked;
}
