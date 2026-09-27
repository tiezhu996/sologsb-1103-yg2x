import type { Cue } from '@/types/cue'
import type { CueLevel, ResolvedLevel } from '@/types/level'

/**
 * 沿时间轴顺序解析一场戏每条 Cue 的有效电平：
 * - 本条自设记录优先（手动动过的通道按本条设置）；
 * - 缺失的通道在「沿袭上一条」开关打开时，取前面最近一条自设过该通道的 Cue 的当前值；
 * - 自设记录随即成为更下游 Cue 的沿袭来源。
 *
 * 入参为当前响应式数据，上游改动后重新调用即可得到联动结果。
 */
export function resolveSessionLevels(orderedCues: readonly Cue[], levels: readonly CueLevel[]): Map<string, ResolvedLevel[]> {
  const ownByCue = new Map<string, Map<string, CueLevel>>()
  levels.forEach((level) => {
    const bucket = ownByCue.get(level.cueId) ?? new Map<string, CueLevel>()
    bucket.set(level.fixtureId, level)
    ownByCue.set(level.cueId, bucket)
  })

  /** 各通道最近一次的上游自设值（沿袭来源） */
  const tracked = new Map<string, Omit<ResolvedLevel, 'source'>>()
  const resolved = new Map<string, ResolvedLevel[]>()

  orderedCues.forEach((cue) => {
    const own = ownByCue.get(cue.id)
    const items: ResolvedLevel[] = []
    if (cue.inheritLevels) {
      tracked.forEach((value, fixtureId) => {
        if (own?.has(fixtureId)) return
        items.push({ ...value, source: 'inherited' })
      })
    }
    own?.forEach((level, fixtureId) => {
      items.push({
        fixtureId,
        intensity: level.intensity,
        colorTempK: level.colorTempK,
        focusNote: level.focusNote,
        source: 'own',
        sourceCueId: cue.id
      })
    })
    resolved.set(cue.id, items)
    own?.forEach((level, fixtureId) => {
      tracked.set(fixtureId, {
        fixtureId,
        intensity: level.intensity,
        colorTempK: level.colorTempK,
        focusNote: level.focusNote,
        sourceCueId: cue.id
      })
    })
  })

  return resolved
}
