import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ElementType, type ReactElement } from 'react';
import { classesOf, loadUi, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { AvatarProps, AvatarSize, AvatarView } from '../app/_ui/Avatar.tsx';

interface AvatarModule {
  Avatar: ElementType & { $$typeof: symbol; render: (props: AvatarProps, ref: unknown) => ReactElement };
  initialsOf: (name: string | null | undefined, max?: number) => string;
  resolveAvatar: (props: Omit<AvatarProps, 'className'>, failedSrc?: string | null) => AvatarView;
  AVATAR_PIXELS: Readonly<Record<AvatarSize, number>>;
}

const SIZES: readonly AvatarSize[] = ['xs', 'sm', 'md', 'lg'];
const SPACE_TOKEN: Readonly<Record<AvatarSize, string>> = { xs: '--space-5', sm: '--space-7', md: '--space-8', lg: '--space-10' };
const PHOTO = 'https://kkfnlbatolfmmpyksdvz.supabase.co/storage/v1/object/sign/avatars/u1.jpg?token=abc';

const uiText = (name: string) => readFileSync(new URL(`../app/_ui/${name}`, import.meta.url), 'utf8');

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing rule ${selector}`);
  return match[1];
}

describe('initialsOf', () => {
  let initialsOf: AvatarModule['initialsOf'];

  before(async () => {
    ({ initialsOf } = await loadUi<AvatarModule>('Avatar.tsx'));
  });

  test('takes the first letters of the first and last words', () => {
    assert.equal(initialsOf('Ada Lovelace'), 'AL');
    assert.equal(initialsOf('ada king lovelace'), 'AL');
    assert.equal(initialsOf('  Grace \t  Hopper  '), 'GH');
    assert.equal(initialsOf('Mary-Jane Watson'), 'MW');
  });

  test('one word gives one letter, and a handle loses its @', () => {
    assert.equal(initialsOf('ada'), 'A');
    assert.equal(initialsOf('@ada_lovelace'), 'A');
    assert.equal(initialsOf('ada.lovelace@example.com'), 'A');
  });

  test('falls back to ? when nothing can be shown', () => {
    for (const name of ['', '   ', null, undefined, '@', '---', '😀 🎉']) {
      assert.equal(initialsOf(name), '?', String(name));
    }
  });

  test('skips punctuation and emoji before a letter', () => {
    assert.equal(initialsOf('(ada) [lovelace]'), 'AL');
    assert.equal(initialsOf('🇳🇬 Chidi Okafor'), 'CO');
    assert.equal(initialsOf('"Bola" Tinubu'), 'BT');
  });

  test('keeps accents and tone marks, composing decomposed input first', () => {
    assert.equal(initialsOf('émile zola'), 'ÉZ');
    assert.equal(initialsOf('Ọlá Adé'), 'ỌA');
    assert.equal(initialsOf('ọ̀ṣun'), 'Ọ̀');
  });

  test('works for scripts without case or spaces', () => {
    assert.equal(initialsOf('王小明'), '王');
    assert.equal(initialsOf('محمد علي'), 'مع');
  });

  test('digits count, and uppercasing never adds letters', () => {
    assert.equal(initialsOf('007 agent'), '0A');
    assert.equal(initialsOf('ß x'), 'ßX');
  });

  test('max of 1 keeps only the first letter, and a nonsense max does too', () => {
    assert.equal(initialsOf('Ada Lovelace', 1), 'A');
    assert.equal(initialsOf('Ada Lovelace', Number.NaN), 'A');
    assert.equal(initialsOf('Ada Lovelace', 3), 'AL');
  });
});

describe('resolveAvatar', () => {
  let resolveAvatar: AvatarModule['resolveAvatar'];
  let AVATAR_PIXELS: AvatarModule['AVATAR_PIXELS'];

  before(async () => {
    ({ resolveAvatar, AVATAR_PIXELS } = await loadUi<AvatarModule>('Avatar.tsx'));
  });

  test('shows the image until that exact URL fails, and a new URL is tried again', () => {
    assert.equal(resolveAvatar({ src: PHOTO, name: 'Ada' }).image, PHOTO);
    assert.equal(resolveAvatar({ src: PHOTO, name: 'Ada' }, PHOTO).image, null);
    assert.equal(resolveAvatar({ src: `${PHOTO}&v=2`, name: 'Ada' }, PHOTO).image, `${PHOTO}&v=2`);
  });

  test('blank or missing sources go straight to initials, and the URL is trimmed', () => {
    for (const src of ['', '   ', null, undefined]) assert.equal(resolveAvatar({ src, name: 'Ada' }).image, null, String(src));
    assert.equal(resolveAvatar({ src: '  /a.png ' }).image, '/a.png');
  });

  test('the label comes from alt, then name, and decorative clears it', () => {
    assert.equal(resolveAvatar({ name: ' Ada Lovelace ' }).label, 'Ada Lovelace');
    assert.equal(resolveAvatar({ name: 'Ada', alt: 'Profile photo of Ada' }).label, 'Profile photo of Ada');
    assert.equal(resolveAvatar({ name: 'Ada', alt: '' }).label, '');
    assert.equal(resolveAvatar({ name: 'Ada', alt: 'Ada', decorative: true }).label, '');
    assert.equal(resolveAvatar({ name: '   ' }).label, '');
    assert.equal(resolveAvatar({ name: null }).label, '');
  });

  test('pixels and the number of initials follow the size', () => {
    assert.deepEqual(AVATAR_PIXELS, { xs: 20, sm: 28, md: 32, lg: 40 });
    for (const size of SIZES) {
      const view = resolveAvatar({ name: 'Ada Lovelace', size });
      assert.equal(view.pixels, AVATAR_PIXELS[size], size);
      assert.equal(view.initials, size === 'xs' ? 'A' : 'AL', size);
    }
    const unknown = resolveAvatar({ name: 'Ada Lovelace', size: 'xl' as AvatarSize });
    assert.equal(unknown.pixels, 28);
    assert.equal(unknown.initials, 'AL');
    assert.equal(resolveAvatar({}).pixels, 28);
  });
});

describe('Avatar', () => {
  let Avatar: AvatarModule['Avatar'];

  before(async () => {
    ({ Avatar } = await loadUi<AvatarModule>('Avatar.tsx'));
  });

  const avatar = (props: AvatarProps) => render(createElement(Avatar, props));

  test('replaces the users page avatar: a lazy, unreferred 28px image with an empty alt', () => {
    assert.equal(
      avatar({ src: PHOTO, name: 'Ada Lovelace', decorative: true }),
      `<span class="avatar sm"><img class="image" src="${PHOTO.replace(/&/g, '&amp;')}" alt="" width="28" height="28" loading="lazy" decoding="async" referrerPolicy="no-referrer"/></span>`,
    );
  });

  test('the fallback is initials on the neutral tile, hidden from screen readers when decorative', () => {
    assert.equal(
      avatar({ name: 'Ada Lovelace', decorative: true }),
      '<span class="avatar sm fallback"><span aria-hidden="true" translate="no">AL</span></span>',
    );
    assert.equal(
      avatar({ src: null, name: '', decorative: true }),
      '<span class="avatar sm fallback"><span aria-hidden="true" translate="no">?</span></span>',
    );
  });

  test('a named avatar is one image to screen readers whether or not the photo loads', () => {
    const photo = avatar({ src: PHOTO, name: 'Ada Lovelace' });
    const [wrapper] = tagsOf(photo, 'span');
    assert.equal('role' in wrapper, false);
    assert.equal(tagsOf(photo, 'img')[0].alt, 'Ada Lovelace');
    const initials = avatar({ name: 'Ada Lovelace', alt: 'Ada Lovelace, account owner' });
    const [frame, letters] = tagsOf(initials, 'span');
    assert.equal(frame.role, 'img');
    assert.equal(frame['aria-label'], 'Ada Lovelace, account owner');
    assert.equal(letters['aria-hidden'], 'true');
    assert.equal(textOf(initials), 'AL');
  });

  test('without a name the fallback shows ? and stays silent instead of reading it', () => {
    const html = avatar({});
    const [frame, letters] = tagsOf(html, 'span');
    assert.equal('role' in frame, false);
    assert.equal('aria-label' in frame, false);
    assert.equal(letters['aria-hidden'], 'true');
    assert.equal(textOf(html), '?');
  });

  test('every size has its class, its image dimensions and its initials count', () => {
    for (const size of SIZES) {
      const photo = avatar({ src: '/a.png', name: 'Ada Lovelace', size, decorative: true });
      assert.deepEqual(classesOf(tagsOf(photo, 'span')[0]), ['avatar', size], size);
      const [img] = tagsOf(photo, 'img');
      const pixels = { xs: '20', sm: '28', md: '32', lg: '40' }[size];
      assert.equal(img.width, pixels, size);
      assert.equal(img.height, pixels, size);
      const initials = avatar({ name: 'Ada Lovelace', size, decorative: true });
      assert.deepEqual(classesOf(tagsOf(initials, 'span')[0]), ['avatar', size, 'fallback'], size);
      assert.equal(textOf(initials), size === 'xs' ? 'A' : 'AL', size);
    }
  });

  test('className merges last and refs are forwarded', () => {
    assert.deepEqual(classesOf(tagsOf(avatar({ name: 'Ada', className: 'leading' }), 'span')[0]), ['avatar', 'sm', 'fallback', 'leading']);
    assert.equal(Avatar.$$typeof, Symbol.for('react.forward_ref'));
  });

  test('the image wires an error handler and replays an error that fired before hydration', () => {
    let tree: ReactElement | null = null;
    function Probe() {
      tree = Avatar.render({ src: PHOTO, name: 'Ada' }, null);
      return tree;
    }
    render(createElement(Probe));
    assert.ok(tree);
    const img = (tree as ReactElement<{ children: ReactElement<Record<string, unknown>> }>).props.children;
    assert.equal(img.type, 'img');
    assert.equal(typeof img.props.onError, 'function');
    const replay = img.props.ref as (image: unknown) => void;
    assert.equal(typeof replay, 'function');

    const fake = (complete: boolean, naturalWidth: number) => {
      const writes: string[] = [];
      const image = {
        complete,
        naturalWidth,
        get src() {
          return PHOTO;
        },
        set src(value: string) {
          writes.push(value);
        },
      };
      replay(image);
      return writes;
    };
    assert.deepEqual(fake(true, 0), [PHOTO]);
    assert.deepEqual(fake(true, 120), []);
    assert.deepEqual(fake(false, 0), []);
    replay(null);
  });

  describe('styles', () => {
    const css = uiText('Avatar.module.css');

    test('each size is a fixed square from the space scale', () => {
      for (const size of SIZES) {
        const body = ruleBody(css, `.${size}`);
        assert.match(body, new RegExp(`width: var\\(${SPACE_TOKEN[size]}\\);\\s*height: var\\(${SPACE_TOKEN[size]}\\)`), size);
      }
      assert.match(ruleBody(css, '.sm'), /font-size: var\(--text-xs\)/);
    });

    test('a clipped circle that cannot change size when the image fails', () => {
      const tile = ruleBody(css, '.avatar');
      assert.match(tile, /box-sizing: border-box/);
      assert.match(tile, /border-radius: var\(--radius-pill\)/);
      assert.match(tile, /overflow: hidden/);
      assert.match(tile, /flex: none/);
      const fallback = ruleBody(css, '.fallback');
      assert.match(fallback, /border: 1px solid var\(--border-default\)/);
      assert.doesNotMatch(fallback, /width|height|padding|margin|box-sizing/);
      const image = ruleBody(css, '.image');
      assert.match(image, /width: 100%;\s*height: 100%/);
      assert.match(image, /object-fit: cover/);
    });

    test('the tile is neutral: no per-user hues, no tone or accent colours, no literals', () => {
      const tile = ruleBody(css, '.avatar');
      assert.match(tile, /background: var\(--bg-muted\)/);
      assert.match(tile, /color: var\(--fg-secondary\)/);
      assert.doesNotMatch(css, /--tone-|--accent-/);
      const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
      for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
        assert.doesNotMatch(value, colour, `${property}: ${value}`);
      }
      assert.doesNotMatch(css, /z-index|\/\*/);
    });

    test('the component source carries no prose comments and no inline styles', () => {
      const source = uiText('Avatar.tsx');
      assert.doesNotMatch(source, /\/\/|\/\*/);
      assert.doesNotMatch(source, /style=/);
    });
  });
});
