const { formatTime, clamp } = require('../renderer/utils')

describe('formatTime', () => {
  test('formats seconds under a minute', () => {
    expect(formatTime(45)).toBe('00:45')
  })
  test('formats minutes and seconds', () => {
    expect(formatTime(754)).toBe('12:34')
  })
  test('formats hours', () => {
    expect(formatTime(5025)).toBe('1:23:45')
  })
  test('returns 00:00 for NaN', () => {
    expect(formatTime(NaN)).toBe('00:00')
  })
  test('returns 00:00 for negative', () => {
    expect(formatTime(-5)).toBe('00:00')
  })
})

describe('clamp', () => {
  test('returns value when within range', () => {
    expect(clamp(50, 0, 100)).toBe(50)
  })
  test('clamps to min', () => {
    expect(clamp(-10, 0, 100)).toBe(0)
  })
  test('clamps to max', () => {
    expect(clamp(150, 0, 100)).toBe(100)
  })
})
