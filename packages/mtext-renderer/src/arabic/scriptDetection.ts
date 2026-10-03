/**
 * Arabic-script detection helpers.
 *
 * These helpers only decide whether a logical Unicode run is a candidate for
 * Arabic shaping. They do not reorder text, alter source content, or perform
 * glyph substitution.
 */

/**
 * Unicode Script=Arabic detector.
 *
 * Property escapes are supported by the package's ES2020 target and cover
 * Arabic letters/marks across the Unicode Arabic blocks without maintaining
 * a fragile hard-coded range table.
 */
const ARABIC_SCRIPT_RE = /\p{Script=Arabic}/u
const LETTER_RE = /\p{Letter}/u

/**
 * Returns true when the logical source contains at least one Arabic-script
 * code point.
 */
export function containsArabicScript(text: string): boolean {
  return ARABIC_SCRIPT_RE.test(text)
}

/**
 * Returns true only for mesh/OpenType text that is a candidate for the future
 * HarfBuzz path.
 *
 * SHX behavior remains explicitly excluded so the existing CAD/SHX pipeline
 * cannot change when Arabic support is introduced.
 */
export function shouldUseArabicShaping(
  text: string,
  fontType: 'mesh' | 'shx' | undefined
): boolean {
  return fontType === 'mesh' && containsArabicScript(text)
}

/**
 * True when text contains Arabic script and no foreign letters.
 * Digits, punctuation and combining marks are allowed.
 *
 * Mixed Arabic/Latin is deliberately deferred to paragraph-level BiDi.
 */
export function isArabicShapingCandidate(text: string): boolean {
  let hasArabic = false

  for (const char of text) {
    if (ARABIC_SCRIPT_RE.test(char)) {
      hasArabic = true
      continue
    }

    if (LETTER_RE.test(char)) {
      return false
    }
  }

  return hasArabic
}
