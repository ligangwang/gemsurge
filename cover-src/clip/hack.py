# Usage: hack.py apply | restore
# Applies (or with "restore", removes) the capture-only changes to the game:
# a set board, a set backdrop, the cover's framing, and hooks to drive swaps.
import sys, shutil, os
HERE=os.path.dirname(os.path.abspath(__file__))
G=os.path.abspath(os.path.join(HERE, '..', '..')); B=os.path.join(HERE, 'bak')
files=['src/gem-scene.ts','src/engine/board.ts','src/levels.ts']
if sys.argv[1]=='restore':
    for f in files: shutil.copy(f'{B}/{os.path.basename(f)}', f'{G}/{f}')
    if os.path.exists(f'{G}/public/__clipbg.png'): os.remove(f'{G}/public/__clipbg.png')
    sys.exit()
os.makedirs(B, exist_ok=True)
for f in files: shutil.copy(f'{G}/{f}', f'{B}/{os.path.basename(f)}')
def edit(f, pairs):
    s=open(f'{G}/{f}').read()
    for a,b in pairs:
        assert s.count(a)==1, (f,a[:60]); s=s.replace(a,b)
    open(f'{G}/{f}','w').write(s)
edit('src/gem-scene.ts', [
("this.composer.addPass(new RenderPass(this.scenery.scene, this.scenery.camera));",
"""const clipBg = (window as any).__clipBg as string | undefined;
    const keyScene = new THREE.Scene();
    if (clipBg) {
      const tex = new THREE.TextureLoader().load(clipBg, () => ((window as any).__bgReady = true));
      tex.colorSpace = THREE.SRGBColorSpace;
      keyScene.background = tex;
      keyScene.backgroundIntensity = 4;
      (window as any).__swap = (a: Pos, b: Pos) => this.options.onSwap(a, b);
    }
    this.composer.addPass(new RenderPass(clipBg ? keyScene : this.scenery.scene, this.scenery.camera));"""),
("""    this.baseDistance = Math.max(distH, distW);
    this.camera.updateProjectionMatrix();""","""    this.baseDistance = Math.max(distH, distW);
    // The cover's framing: the board smaller and a little left of the middle.
    if ((window as any).__clipBg) this.camera.setViewOffset(w, h, -0.045459 * w, -0.111247 * h, 1.220492 * w, 1.220492 * h);
    this.camera.updateProjectionMatrix();"""),
("""  setInput(on: boolean) {
    this.inputOn = on;""","""  setInput(on: boolean) {
    this.inputOn = on;
    (window as any).__input = on;"""),
])
edit('src/engine/board.ts', [
("""  } while (!findHint(b));
  return b;
}""","""  } while (!findHint(b));
  const clip = (globalThis as any).__clip;
  if (clip) {
    b.nextId = 1;
    b.cells = clip.cells.map((c: number) => newGem(b, c));
    b.ice = [...clip.ice];
  }
  return b;
}"""),
])
edit('src/levels.ts', [("const FIVE = [0, 1, 2, 3, 4] as const;","const FIVE = [0, 1, 2, 3, 4, 5, 6] as const;")])
shutil.copy(os.path.join(HERE, 'bg.png'), f'{G}/public/__clipbg.png')
