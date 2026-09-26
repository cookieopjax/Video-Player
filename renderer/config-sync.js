function createConfigSync({ normalizeConfig, applyConfig }) {
  let current = null
  let fingerprint = null

  function update(rawConfig) {
    const next = normalizeConfig(rawConfig)
    const nextFingerprint = JSON.stringify(next)
    if (nextFingerprint === fingerprint) {
      return { changed: false, config: current }
    }

    current = next
    fingerprint = nextFingerprint
    applyConfig(next)
    return { changed: true, config: next }
  }

  return {
    update,
    get current() { return current },
  }
}

if (typeof module !== 'undefined') module.exports = { createConfigSync }
