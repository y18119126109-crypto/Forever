const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function verifyMacSignature(appPath) {
  if (process.platform !== 'darwin') {
    throw new Error('macOS signature verification requires codesign on macOS.');
  }
  const app = path.resolve(appPath);
  const sqlite = path.join(app, 'Contents/Resources/app.asar.unpacked/node_modules/sqlite3/build/Release/node_sqlite3.node');
  const seal = path.join(app, 'Contents/_CodeSignature/CodeResources');
  if (!fs.existsSync(seal)) {
    throw new Error(`Missing app resource seal: ${seal}. Refusing to distribute an unsigned/repacked app.`);
  }
  // --deep covers the Electron framework and helper apps. Verify sqlite3
  // explicitly because it lives under Resources rather than Frameworks.
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', sqlite], { stdio: 'inherit' });
  process.stdout.write(`Verified macOS app resource seal, nested signatures and sqlite3: ${app}\n`);
}

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  verifyMacSignature(path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`));
};
module.exports.verifyMacSignature = verifyMacSignature;

if (require.main === module) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/verify-macos-signature.js /path/to/Forever.app');
    process.exitCode = 2;
  } else {
    try {
      verifyMacSignature(process.argv[2]);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
