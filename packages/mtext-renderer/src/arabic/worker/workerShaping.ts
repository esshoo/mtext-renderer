import type {
  HarfBuzzFontProgramSource,
  HarfBuzzRuntime
} from '../harfbuzz'
import {
  createHarfBuzzArabicTextShaperFromFontProgramSource
} from '../harfbuzz'
import type {
  ArabicMTextShapingOptions,
  ArabicWorkerShapingOptions
} from '../types'

export type HarfBuzzRuntimeModuleLoader = (
  moduleUrl: string
) => Promise<HarfBuzzRuntime>

function isHarfBuzzRuntime(value: unknown): value is HarfBuzzRuntime {
  if (!value || typeof value !== 'object') {
    return false
  }

  const runtime = value as Partial<HarfBuzzRuntime>
  return (
    typeof runtime.Blob === 'function' &&
    typeof runtime.Face === 'function' &&
    typeof runtime.Font === 'function' &&
    typeof runtime.Buffer === 'function' &&
    typeof runtime.shape === 'function' &&
    !!runtime.Direction &&
    typeof runtime.Direction.LTR === 'number' &&
    typeof runtime.Direction.RTL === 'number'
  )
}

/**
 * Loads a HarfBuzz runtime inside the current Worker isolate.
 *
 * The variable URL plus `@vite-ignore` deliberately keeps this import external
 * to mtext-renderer's worker bundle. Applications opt in by hosting a trusted
 * ESM HarfBuzz runtime themselves.
 */
export async function loadHarfBuzzRuntimeModule(
  moduleUrl: string
): Promise<HarfBuzzRuntime> {
  const resolvedUrl = moduleUrl.trim()
  if (!resolvedUrl) {
    throw new Error('Arabic worker runtimeModuleUrl must not be empty.')
  }

  const loaded: unknown = await import(
    /* @vite-ignore */
    resolvedUrl
  )

  if (!isHarfBuzzRuntime(loaded)) {
    throw new Error(
      'Arabic worker runtime module does not expose the required HarfBuzz API.'
    )
  }

  return loaded
}

/**
 * Creates the same synchronous renderer configuration used on the main thread,
 * but entirely inside a Worker isolate.
 *
 * Font bytes come from the existing mesh-font program cache, so the worker does
 * not retain a second raw copy on MeshFont and does not receive font bytes over
 * `postMessage`.
 */
export async function createArabicWorkerShapingOptions(
  source: HarfBuzzFontProgramSource,
  options: ArabicWorkerShapingOptions,
  loadRuntime: HarfBuzzRuntimeModuleLoader = loadHarfBuzzRuntimeModule
): Promise<ArabicMTextShapingOptions | undefined> {
  if (!options.fontName.trim()) {
    return undefined
  }

  const runtime = await loadRuntime(options.runtimeModuleUrl)
  const shaper =
    await createHarfBuzzArabicTextShaperFromFontProgramSource(
      source,
      runtime,
      options.fontName
    )

  if (!shaper) {
    return undefined
  }

  return {
    fontName: options.fontName,
    shaper,
    direction: options.direction ?? 'rtl',
    language: options.language ?? 'ar'
  }
}
