// Gera os ícones PNG da PWA a partir de public/logo.svg usando o Chromium do Playwright.
// Uso: node scripts/gen-icons.mjs  (requer playwright ou playwright-core e um Chromium)
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import('playwright-core').catch(() => import('playwright'));
const svg = fs.readFileSync(path.resolve('public/logo.svg'), 'utf8');
const out = path.resolve('public/icons');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
const render = async (file, size, pad, bg) => {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`);
  await page.screenshot({ path: path.join(out, file), omitBackground: bg === 'transparent' });
};
await render('icon-192.png', 192, 0, 'transparent');
await render('icon-512.png', 512, 0, 'transparent');
await render('icon-maskable-512.png', 512, 0.12, '#1d4ed8');
await render('apple-touch-icon.png', 180, 0.08, '#1d4ed8');
await browser.close();
console.log('Ícones gerados em', out);
