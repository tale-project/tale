/**
 * In-app title, scene-change, and outro cards. The take never leaves the SPA:
 * the app loads and settles BEFORE the screencast starts, the title card sits
 * on top as a DOM overlay, and "entering the workspace" is a fade-out
 * unveiling an already-rendered page — a full page load re-boots the app on
 * camera and shows skeletons no warm-up can hide.
 *
 * The overlay sits just below the cursor overlay's z-index and inherits
 * nothing from the app (own styles, solid background).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(HERE, '../../../../..');
const LOGO_SVG = readFileSync(
  path.join(REPO_ROOT, 'services/docs/public/images/logo-text-white.svg'),
  'utf8',
);

interface CardStrings {
  readonly title: string;
  readonly episodeLabel: string;
}

/**
 * Install the card helpers and show the (unrevealed) title card. Call after
 * the app has settled and before the screencast starts, so frame one is the
 * card. Exposes `window.__taleVideoCard`: `reveal()` animates the title
 * content in; `fadeOutAndRemove(ms)` unveils the app;
 * `showChapter(label, veil)` plays the self-timed scene change — with `veil`
 * a blur covers the URL hard-cut and the card rides on top, without it only
 * the bottom-left card plays over the on-camera navigation; `showOutro()`
 * fades the outro card in over whatever is on screen.
 */
export async function installVideoCards(
  page: Page,
  strings: CardStrings,
): Promise<void> {
  await page.evaluate(
    ([logoSvg, title, episodeLabel]) => {
      const Z = 2147483600; // below the cursor overlay, above everything else
      const FONT = "'Inter', system-ui, -apple-system, sans-serif";
      const BG =
        'radial-gradient(1200px 700px at 50% 38%, rgba(59,130,246,0.14), transparent 60%), #0b0e14';

      const style = document.createElement('style');
      style.textContent = [
        '#tale-video-card .tale-card-inner { display:flex; flex-direction:column; align-items:center; opacity:0; transform:translateY(14px); }',
        '#tale-video-card.revealed .tale-card-inner { opacity:1; transform:translateY(0); transition: opacity 900ms cubic-bezier(0.22,1,0.36,1), transform 900ms cubic-bezier(0.22,1,0.36,1); }',
        // The inlined SVG root carries width/height attributes (62×17) — without
        // this override it renders at attribute size instead of the wrapper width.
        '#tale-video-card .tale-card-logo svg { display:block; width:100%; height:auto; }',
      ].join('\n');
      document.head.appendChild(style);

      const makeCard = (inner: string, gapPx: number): HTMLDivElement => {
        const card = document.createElement('div');
        card.id = 'tale-video-card';
        card.setAttribute('aria-hidden', 'true');
        card.style.cssText =
          `position:fixed;inset:0;z-index:${Z};display:grid;place-items:center;` +
          `background:${BG};font-family:${FONT};color:#f8fafc;`;
        card.innerHTML = `<div class="tale-card-inner" style="gap:${gapPx}px">${inner}</div>`;
        return card;
      };

      const logoWrap = (width: number) =>
        `<div class="tale-card-logo" style="width:${width}px">${logoSvg}</div>`;

      const handle = {
        showTitle() {
          document.getElementById('tale-video-card')?.remove();
          const card = makeCard(
            logoWrap(280) +
              '<div style="width:72px;height:3px;border-radius:999px;background:#3b82f6"></div>' +
              `<div style="font-size:22px;letter-spacing:0.24em;text-transform:uppercase;color:#93a4bd">${episodeLabel}</div>` +
              `<h1 style="margin:0;font-size:72px;font-weight:600;letter-spacing:-0.02em;text-align:center;max-width:26ch">${title}</h1>`,
            28,
          );
          document.body.appendChild(card);
        },
        reveal() {
          document.getElementById('tale-video-card')?.classList.add('revealed');
        },
        fadeOutAndRemove(ms: number) {
          const card = document.getElementById('tale-video-card');
          if (!card) return;
          card.style.transition = `opacity ${ms}ms ease-out`;
          card.style.opacity = '0';
          setTimeout(() => card.remove(), ms + 60);
        },
        showChapter(label: string, veil: boolean) {
          document.getElementById('tale-video-chapter')?.remove();
          document.getElementById('tale-video-chapter-card')?.remove();

          const showCard = (): HTMLDivElement => {
            const card = document.createElement('div');
            card.id = 'tale-video-chapter-card';
            card.setAttribute('aria-hidden', 'true');
            card.style.cssText =
              `position:fixed;left:48px;bottom:48px;z-index:${Z};display:flex;align-items:center;gap:14px;` +
              'padding:14px 22px;border-radius:12px;background:rgba(11,14,20,0.92);' +
              'box-shadow:0 8px 30px rgba(0,0,0,0.35);pointer-events:none;' +
              `font-family:${FONT};color:#f8fafc;opacity:0;transform:translateY(14px);` +
              'transition:opacity 380ms cubic-bezier(0.25,0,0.2,1),transform 380ms cubic-bezier(0.25,0,0.2,1);';
            card.innerHTML =
              '<div style="width:4px;height:22px;border-radius:999px;background:#3b82f6"></div>' +
              `<div style="font-size:17px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e2e8f0">${label}</div>`;
            document.body.appendChild(card);
            // Flush styles first, or the transition starts already-applied.
            card.getBoundingClientRect();
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
            return card;
          };
          const hideCard = (card: HTMLDivElement, afterMs: number) => {
            setTimeout(() => {
              card.style.transition =
                'opacity 380ms cubic-bezier(0.4,0,0.7,1),transform 380ms cubic-bezier(0.4,0,0.7,1)';
              card.style.opacity = '0';
              card.style.transform = 'translateY(14px)';
              setTimeout(() => {
                card.remove();
                if (veil) window.__taleCursor?.unveil?.();
              }, 440);
            }, afterMs);
          };

          if (!veil) {
            // Navigating chapter: the on-camera navigation IS the
            // transition — only the card plays, the cursor stays visible.
            hideCard(showCard(), 2100);
            return;
          }

          // Hard-cut chapter: the URL swaps under a blur veil while the
          // cursor stays hidden. Constant blur + animated OPACITY — the veil
          // cross-fades as one composited surface; animating the blur radius
          // re-filters every frame and visibly steps. pointer-events:none:
          // the choreography's REAL clicks land through the overlay.
          window.__taleCursor?.veil?.();
          const overlay = document.createElement('div');
          overlay.id = 'tale-video-chapter';
          overlay.setAttribute('aria-hidden', 'true');
          overlay.style.cssText =
            `position:fixed;inset:0;z-index:${Z};pointer-events:none;` +
            'background:rgba(8,11,17,0.45);backdrop-filter:blur(28px);' +
            'opacity:0;transition:opacity 420ms cubic-bezier(0.25,0,0.2,1);';
          document.body.appendChild(overlay);
          overlay.getBoundingClientRect();
          overlay.style.opacity = '1';
          setTimeout(() => {
            const card = showCard();
            setTimeout(() => {
              overlay.style.transition =
                'opacity 620ms cubic-bezier(0.4,0,0.6,1)';
              overlay.style.opacity = '0';
              setTimeout(() => overlay.remove(), 680);
              hideCard(card, 700);
            }, 1000);
          }, 450);
        },
        showOutro() {
          document.getElementById('tale-video-card')?.remove();
          const card = makeCard(
            logoWrap(320) +
              '<div style="font-size:30px;letter-spacing:0.02em;color:#93a4bd">tale.dev/docs</div>',
            32,
          );
          card.style.opacity = '0';
          card.style.transition = 'opacity 800ms ease-in';
          document.body.appendChild(card);
          // Flush styles first, or the fade and slide-up start already-applied.
          card.getBoundingClientRect();
          card.style.opacity = '1';
          card.classList.add('revealed');
        },
      };
      (
        window as unknown as { __taleVideoCard?: typeof handle }
      ).__taleVideoCard = handle;
      handle.showTitle();
    },
    [LOGO_SVG, strings.title, strings.episodeLabel] as const,
  );
}
