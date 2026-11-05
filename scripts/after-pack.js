const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Arch } = require('builder-util');

const NAPI_VERSION = '6';
const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32']);

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `${path.basename(command)} exited with ${signal ? `signal ${signal}` : `code ${code}`}`
      ));
    });
  });
}

function verifyNativeBinary(filePath, platform, arch) {
  const header = Buffer.alloc(512);
  const file = fs.openSync(filePath, 'r');
  try {
    fs.readSync(file, header, 0, header.length, 0);
  } finally {
    fs.closeSync(file);
  }

  if (platform === 'win32') {
    if (header.toString('ascii', 0, 2) !== 'MZ') {
      throw new Error(`Expected a Windows PE binary at ${filePath}`);
    }
    const peOffset = header.readUInt32LE(0x3c);
    if (peOffset + 6 > header.length || header.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') {
      throw new Error(`Invalid Windows PE header at ${filePath}`);
    }
    if (header.readUInt16LE(peOffset + 4) !== 0x8664 || arch !== 'x64') {
      throw new Error(`Expected a Windows x64 native module at ${filePath}`);
    }
    return;
  }

  const magic = header.readUInt32LE(0);
  const cpuType = header.readUInt32LE(4);
  const expectedCpuType = arch === 'arm64' ? 0x0100000c : 0x01000007;
  if (magic !== 0xfeedfacf || cpuType !== expectedCpuType) {
    throw new Error(`Expected a macOS ${arch} Mach-O binary at ${filePath}`);
  }
}

module.exports = async function installSqlitePrebuild(context) {
  const platform = context.electronPlatformName;
  if (!SUPPORTED_PLATFORMS.has(platform)) return;

  const arch = Arch[context.arch];
  if (!['arm64', 'x64'].includes(arch)) {
    throw new Error(`Unsupported desktop architecture: ${arch}`);
  }

  const sqliteDirectory = path.dirname(require.resolve('sqlite3/package.json'));
  const prebuildInstall = require.resolve('prebuild-install/bin.js', {
    paths: [sqliteDirectory]
  });
  const temporaryDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), `swagger-sqlite-${platform}-${arch}-`)
  );

  try {
    await fsPromises.copyFile(
      path.join(sqliteDirectory, 'package.json'),
      path.join(temporaryDirectory, 'package.json')
    );
    await run(process.execPath, [
      prebuildInstall,
      '--runtime', 'napi',
      '--target', NAPI_VERSION,
      '--platform', platform,
      '--arch', arch,
      '--path', temporaryDirectory,
      '--force'
    ], {
      cwd: sqliteDirectory,
      env: {
        ...process.env,
        npm_config_build_from_source: 'false'
      }
    });

    const source = path.join(
      temporaryDirectory,
      'build',
      'Release',
      'node_sqlite3.node'
    );
    verifyNativeBinary(source, platform, arch);

    const destination = path.join(
      context.packager.getResourcesDir(context.appOutDir),
      'app.asar.unpacked',
      'node_modules',
      'sqlite3',
      'build',
      'Release',
      'node_sqlite3.node'
    );
    await fsPromises.copyFile(source, destination);
    verifyNativeBinary(destination, platform, arch);
    process.stdout.write(
      `Verified sqlite3 native module for ${platform}-${arch}: ${destination}\n`
    );
  } finally {
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  }
};
