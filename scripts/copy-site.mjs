// Copies the static page and the exact three.js files it imports into dist/site.
// three.js is served from the package, not a CDN: no third-party code at runtime, and it works offline.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

cpSync('site', 'dist/site', { recursive: true, filter: (f) => !f.endsWith('.ts') });

const three = 'node_modules/three';
const vendor = 'dist/site/vendor';
const files = {
  'three.module.min.js': 'build/three.module.min.js',
  LICENSE: 'LICENSE',
  ...Object.fromEntries([
    'controls/OrbitControls.js',
    'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/UnrealBloomPass.js',
    'postprocessing/OutputPass.js', 'postprocessing/Pass.js', 'postprocessing/ShaderPass.js', 'postprocessing/MaskPass.js',
    'renderers/CSS2DRenderer.js',
    'shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js', 'shaders/OutputShader.js',
  ].map((f) => [`addons/${f}`, `examples/jsm/${f}`])),
};
for (const [to, from] of Object.entries(files)) {
  mkdirSync(dirname(join(vendor, to)), { recursive: true });
  cpSync(join(three, from), join(vendor, to));
}
