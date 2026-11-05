function isNavigationAbort(error) {
  if (!error) return false;
  return error.code === 'ERR_ABORTED'
    || Number(error.errno) === -3
    || /\bERR_ABORTED\b/.test(String(error.message || ''));
}

function canIgnoreLocalNavigationAbort(error, currentUrl, isLocalUrl) {
  return isNavigationAbort(error)
    && typeof isLocalUrl === 'function'
    && isLocalUrl(currentUrl);
}

module.exports = {
  canIgnoreLocalNavigationAbort,
  isNavigationAbort
};
