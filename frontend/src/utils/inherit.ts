import type { Cue } from '@/types/cue'
import type { CueLevel, ResolvedLevel } from '@/types/level'

/**
 * 沿袭解析：按时间轴顺序逐条计算每条 Cue 的生效电平。
 * - 本条手动设定（own）的通道优先；
 * - 开启「沿袭上一条」且本条未自设的通道，取上游最近一条自设电平，
 *   上游之后调整亮度 / 色温时这里同步跟随；
 * - 未开启沿袭的 Cue 只使用本条自设电平（与既往行为一致）。
 *
 * 入参 `orderedCues` 必须已按落库位次排好序（sortCues 的结果）。
 */
export function resolveSessionLevels(
  orderedCues: readonly Cue[],
  levelsOfCue: (cueId: string) => CueLevel[]
): Map<string, ResolvedLevel[]> {
  const resolvedByCue = new Map<string, ResolvedLevel[]>()
  /** 上游最近一条自设电平：fixtureId → 电平与所属 Cue */
  const upstream = new Map<string, { level: CueLevel; cueId: string }>()

  orderedCues.forEach((cue) => {
    const resolved = new Map<string, ResolvedLevel>()

    if (cue.inheritLevels) {
      upstream.forEach(({ level, cueId }, fixtureId) => {
        resolved.set(fixtureId, {
          cueId: cue.id,
          fixtureId,
          intensity: level.intensity,
          colorTempK: level.colorTempK,
          focusNote: level.focusNote,
          source: 'inherited',
          sourceCueId: cueId
        })
      })
    }

    levelsOfCue(cue.id).forEach((level) => {
      resolved.set(level.fixtureId, {
        cueId: cue.id,
        fixtureId: level.fixtureId,
        intensity: level.intensity,
        colorTempK: level.colorTempK,
        focusNote: level.focusNote,
        source: 'own',
        sourceCueId: null
      })
      upstream.set(level.fixtureId, { level, cueId: cue.id })
    })

    resolvedByCue.set(cue.id, Array.from(resolved.values()))
  })

  return resolvedByCue
}

/** 在单条 Cue 的生效电平中查某个通道 */
export function resolvedLevelOf(resolved: readonly ResolvedLevel[] | undefined, fixtureId: string): ResolvedLevel | null {
  return resolved?.find((item) => item.fixtureId === fixtureId) ?? null
}
