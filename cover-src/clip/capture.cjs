// Plays the scripted moves in the game with time under our control, and saves
// one picture every 30th of a second. Usage: capture.cjs outDir [maxFrames]
const { chromium } = require('playwright');
const fs = require('fs');
const L = 'RDESATM';
const ROWS = 'EMDRATDS DARMETME MSEDRASD ADMSETTM REAMDTRA DMSSESMR ERDASEDR MDREMDAE'.split(' ');
const ICE = '11111111 10022001 10022001 12222221 12222221 10022001 10022001 11111111'.split(' ').join('').split('').map(Number);
const MOVES = [[[6, 4], [7, 4]], [[4, 6], [4, 5]], [[6, 3], [5, 3]], [[5, 5], [4, 5]]];
(async () => {
  const out = process.argv[2];
  const max = Number(process.argv[3] || 300);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.addInitScript(({ cells, ice }) => { window.__clip = { cells, ice }; window.__clipBg = './__clipbg.png'; },
    { cells: ROWS.join('').split('').map((c) => L.indexOf(c)), ice: ICE });
  await p.clock.install();
  await p.goto('http://localhost:5295/');
  await p.getByRole('button', { name: 'Play', exact: true }).click();
  await p.addStyleTag({ content: '.gem-app > *:not(.gem-host) { display: none !important; } .gem-host { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; left: 0 !important; } .gem-overlay { display: none !important; }' });
  await p.evaluate(() => window.dispatchEvent(new Event('resize')));
  await p.waitForFunction(() => window.__input === true && window.__bgReady === true, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.clock.pauseAt(new Date(Date.now() + 5000));
  let next = 0, idle = 0, last = -1;
  const t0 = Date.now();
  for (let f = 0; f < max; f++) {
    await p.clock.runFor(1000 / 30);
    await p.screenshot({ path: `${out}/f${String(f).padStart(4, '0')}.png`, timeout: 120000 });
    const input = await p.evaluate(() => window.__input);
    idle = input ? idle + 1 : 0;
    if (next < MOVES.length && idle >= (next === 0 ? 14 : 7)) {
      const [a, c] = MOVES[next++];
      // Not awaited: the swap's animation only runs as the clock is stepped.
      await p.evaluate(([a, c]) => void window.__swap({ x: a[0], y: a[1] }, { x: c[0], y: c[1] }), [a, c]);
      console.log('frame', f, 'move', next, `(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      idle = 0; last = f;
    }
    if (next === MOVES.length && (idle >= 20 || f - last > 130)) { console.log('done at frame', f); break; }
  }
  await b.close();
})();
