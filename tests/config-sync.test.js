const { createConfigSync } = require('../renderer/config-sync')

describe('createConfigSync', () => {
  test('normalizes an incoming config before applying it', () => {
    const applyConfig = jest.fn()
    const normalizeConfig = raw => ({ jumpSeconds: Math.max(1, Number(raw.jumpSeconds) || 15) })
    const sync = createConfigSync({ normalizeConfig, applyConfig })

    const result = sync.update({ jumpSeconds: 0 })

    expect(result).toEqual({ changed: true, config: { jumpSeconds: 15 } })
    expect(applyConfig).toHaveBeenCalledWith({ jumpSeconds: 15 })
  })

  test('suppresses a repeated normalized config', () => {
    const applyConfig = jest.fn()
    const sync = createConfigSync({
      normalizeConfig: raw => ({ enabled: raw.enabled === true }),
      applyConfig,
    })

    sync.update({ enabled: true, ignored: 'first' })
    const result = sync.update({ enabled: true, ignored: 'second' })

    expect(result).toEqual({ changed: false, config: { enabled: true } })
    expect(applyConfig).toHaveBeenCalledTimes(1)
  })

  test('applies each changed normalized config exactly once', () => {
    const applied = []
    const sync = createConfigSync({
      normalizeConfig: raw => ({ jumpSeconds: raw.jumpSeconds }),
      applyConfig: config => applied.push(config),
    })

    sync.update({ jumpSeconds: 5 })
    sync.update({ jumpSeconds: 10 })

    expect(applied).toEqual([{ jumpSeconds: 5 }, { jumpSeconds: 10 }])
    expect(sync.current).toEqual({ jumpSeconds: 10 })
  })
})
