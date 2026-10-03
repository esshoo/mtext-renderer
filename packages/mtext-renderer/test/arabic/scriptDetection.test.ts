import { describe, expect, test } from 'vitest'

import {
  containsArabicScript,
  shouldUseArabicShaping
} from '../../src/arabic/scriptDetection'

describe('Arabic script detection', () => {
  test('detects Arabic logical Unicode text', () => {
    expect(containsArabicScript('السلام عليكم')).toBe(true)
    expect(containsArabicScript('غرفة A-102')).toBe(true)
    expect(containsArabicScript('مُحَمَّد')).toBe(true)
  })

  test('does not classify Latin/CJK text as Arabic', () => {
    expect(containsArabicScript('Hello World')).toBe(false)
    expect(containsArabicScript('A-102 25.50 m²')).toBe(false)
    expect(containsArabicScript('中文文字')).toBe(false)
    expect(containsArabicScript('')).toBe(false)
  })

  test('only routes Arabic candidates for mesh fonts', () => {
    expect(shouldUseArabicShaping('السلام', 'mesh')).toBe(true)
    expect(shouldUseArabicShaping('السلام', 'shx')).toBe(false)
    expect(shouldUseArabicShaping('السلام', undefined)).toBe(false)
    expect(shouldUseArabicShaping('Hello', 'mesh')).toBe(false)
  })
})
