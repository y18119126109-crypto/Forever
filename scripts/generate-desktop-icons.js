const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build');
const source = path.join(buildDir, 'icon-source.png');
const iconPng = path.join(buildDir, 'icon.png');
const windowsPng = path.join(buildDir, 'icon-win.png');
const iconsetDir = path.join(buildDir, 'icon.iconset');
const windowsDir = path.join(buildDir, 'icon-windows');

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function resize(size, output, input = iconPng) {
  run('sips', ['-z', String(size), String(size), input, '--out', output]);
}

function roundedIcon(output, inset, radius) {
  const size = 1024;
  const side = size - inset * 2;
  const temporary = path.join(buildDir, 'icon-resized.png');
  resize(side, temporary, source);
  const input = PNG.sync.read(fs.readFileSync(temporary));
  const canvas = new PNG({ width: size, height: size });
  canvas.data.fill(0);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const dx = Math.max(Math.abs(x + 0.5 - side / 2) - (side / 2 - radius), 0);
      const dy = Math.max(Math.abs(y + 0.5 - side / 2) - (side / 2 - radius), 0);
      const alpha = Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(dx, dy)));
      const from = (y * side + x) * 4;
      const to = ((y + inset) * size + x + inset) * 4;
      input.data.copy(canvas.data, to, from, from + 3);
      canvas.data[to + 3] = Math.round(input.data[from + 3] * alpha);
    }
  }
  fs.writeFileSync(output, PNG.sync.write(canvas));
  fs.rmSync(temporary);
}

function createIco(images, output) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;
  images.forEach(({ size, bytes }, index) => {
    const start = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, start);
    directory.writeUInt8(size >= 256 ? 0 : size, start + 1);
    directory.writeUInt8(0, start + 2);
    directory.writeUInt8(0, start + 3);
    directory.writeUInt16LE(1, start + 4);
    directory.writeUInt16LE(32, start + 6);
    directory.writeUInt32LE(bytes.length, start + 8);
    directory.writeUInt32LE(offset, start + 12);
    offset += bytes.length;
  });

  fs.writeFileSync(output, Buffer.concat([
    header,
    directory,
    ...images.map(({ bytes }) => bytes)
  ]));
}

if (process.platform !== 'darwin') {
  throw new Error('Desktop icon generation currently requires macOS sips and iconutil.');
}
if (!fs.existsSync(source)) {
  throw new Error(`Missing icon source: ${source}`);
}

fs.mkdirSync(buildDir, { recursive: true });
fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.rmSync(windowsDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });
fs.mkdirSync(windowsDir, { recursive: true });

// macOS has an 80% artwork canvas; Windows uses more of its small taskbar tile.
roundedIcon(iconPng, 100, 185);
roundedIcon(windowsPng, 40, 185);
const assets = path.join(root, 'public', 'assets');
fs.mkdirSync(assets, { recursive: true });
resize(512, path.join(assets, 'forever-avatar.png'), source);
resize(512, path.join(assets, 'forever-icon-512.png'));
resize(192, path.join(assets, 'forever-icon-192.png'));

[
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
].forEach(([size, filename]) => resize(size, path.join(iconsetDir, filename)));

run('iconutil', [
  '-c', 'icns',
  iconsetDir,
  '-o', path.join(buildDir, 'icon.icns')
]);

const windowsImages = [16, 24, 32, 48, 64, 128, 256].map((size) => {
  const output = path.join(windowsDir, `icon-${size}.png`);
  resize(size, output, windowsPng);
  return { size, bytes: fs.readFileSync(output) };
});
createIco(windowsImages, path.join(buildDir, 'icon.ico'));

fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.rmSync(windowsDir, { recursive: true, force: true });

console.log('Generated build/icon.png, build/icon.icns and build/icon.ico');
