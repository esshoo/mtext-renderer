import { describe, expect, test } from 'vitest'

import {
  containsArabicScript,
  isArabicShapingCandidate,
  shouldUseArabicShaping
} from '../../src/arabic/scriptDetection'

describe('Arabic script detection', () => {
  test('detects Arabic logical Unicode text', () => {
    expect(
      containsArabicScript(
        '\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645'
      )
    ).toBe(true)
    expect(
      containsArabicScript('\u063a\u0631\u0641\u0629 A-102')
    ).toBe(true)
    expect(
      containsArabicScript(
        '\u0645\u064f\u062d\u064e\u0645\u064e\u0651\u062f'
      )
    ).toBe(true)
  })

  test('does not classify Latin/CJK text as Arabic', () => {
    expect(containsArabicScript('Hello World')).toBe(false)
    expect(containsArabicScript('A-102 25.50 m\u00b2')).toBe(false)
    expect(
      containsArabicScript('\u4e2d\u6587\u6587\u5b57')
    ).toBe(false)
    expect(containsArabicScript('')).toBe(false)
  })

  test('only routes Arabic candidates for mesh fonts', () => {
    const arabic = '\u0627\u0644\u0633\u0644\u0627\u0645'
    expect(shouldUseArabicShaping(arabic, 'mesh')).toBe(true)
    expect(shouldUseArabicShaping(arabic, 'shx')).toBe(false)
    expect(shouldUseArabicShaping(arabic, undefined)).toBe(false)
    expect(shouldUseArabicShaping('Hello', 'mesh')).toBe(false)
  })

  test('keeps mixed foreign letters out of the first Arabic renderer hook', () => {
    const salaam = '\u0633\u0644\u0627\u0645'
    const room = '\u063a\u0631\u0641\u0629'
    const price = '\u0627\u0644\u0633\u0639\u0631'

    expect(isArabicShapingCandidate(salaam)).toBe(true)
    expect(isArabicShapingCandidate(`${room}-102`)).toBe(true)
    expect(isArabicShapingCandidate(`${price} 123.45`)).toBe(true)
    expect(isArabicShapingCandidate(`${salaam}A`)).toBe(false)
    expect(isArabicShapingCandidate(`Room${salaam}`)).toBe(false)
    expect(
      isArabicShapingCandidate(`\u4e2d\u6587${salaam}`)
    ).toBe(false)
  })
})