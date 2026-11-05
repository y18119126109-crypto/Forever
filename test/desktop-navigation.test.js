const assert = require('node:assert/strict');
const test = require('node:test');

const desktopNavigation = require('../src/desktop-navigation');

test('recognizes Electron navigation abort variants', () => {
  assert.equal(
    desktopNavigation.isNavigationAbort({ code: 'ERR_ABORTED' }),
    true
  );
  assert.equal(
    desktopNavigation.isNavigationAbort({ errno: -3 }),
    true
  );
  assert.equal(
    desktopNavigation.isNavigationAbort(
      new Error("ERR_ABORTED (-3) loading 'http://127.0.0.1:18473/debug.html'")
    ),
    true
  );
  assert.equal(
    desktopNavigation.isNavigationAbort({ code: 'ERR_CONNECTION_REFUSED' }),
    false
  );
});

test('only ignores an aborted navigation when a local page remains active', () => {
  const isLocalUrl = (value) => {
    try {
      return new URL(value).origin === 'http://127.0.0.1:18473';
    } catch (error) {
      return false;
    }
  };

  assert.equal(
    desktopNavigation.canIgnoreLocalNavigationAbort(
      { code: 'ERR_ABORTED' },
      'http://127.0.0.1:18473/debug.html',
      isLocalUrl
    ),
    true
  );
  assert.equal(
    desktopNavigation.canIgnoreLocalNavigationAbort(
      { code: 'ERR_CONNECTION_REFUSED' },
      'http://127.0.0.1:18473/',
      isLocalUrl
    ),
    false
  );
  assert.equal(
    desktopNavigation.canIgnoreLocalNavigationAbort(
      { code: 'ERR_ABORTED' },
      'https://example.com/',
      isLocalUrl
    ),
    false
  );
});
