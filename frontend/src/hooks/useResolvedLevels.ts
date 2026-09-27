import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { ResolvedLevel } from '@/types/level'
import { useCueStore } from '@/stores/cueStore'
import { useLevelStore } from '@/stores/levelStore'
import { resolveSessionLevels } from '@/utils/levelResolve'

/** `useResolvedLevels` 暴露的解析结果与查询动作 */
export interface UseResolvedLevelsReturn {
  /** 按 Cue id 索引的有效电平（自设优先，沿袭补充），随上游改动联动重算 */
  resolvedByCue: ComputedRef<Map<string, ResolvedLevel[]>>
  /** 某条 Cue 的有效电平列表 */
  resolvedOfCue: (cueId: string) => ResolvedLevel[]
  /** 某条 Cue 下某个通道的有效电平 */
  resolvedLevelOf: (cueId: string, fixtureId: string) => ResolvedLevel | null
  /** 沿袭后的通道平均亮度：对本场全部 Cue 的有效电平取平均 */
  averageIntensityOfFixture: (fixtureId: string) => number | null
}

/**
 * 一场戏的有效电平解析：自设记录优先，「沿袭上一条」打开时缺失通道跟随上游最近自设值。
 * 被 Cue 时间轴、灯位配置台与电平编辑页共同消费。
 */
export function useResolvedLevels(sessionId: MaybeRefOrGetter<string>): UseResolvedLevelsReturn {
  const cueStore = useCueStore()
  const levelStore = useLevelStore()

  const resolvedByCue = computed(() => resolveSessionLevels(cueStore.sortedCuesOfSession(toValue(sessionId)), levelStore.levels))

  function resolvedOfCue(cueId: string): ResolvedLevel[] {
    return resolvedByCue.value.get(cueId) ?? []
  }

  function resolvedLevelOf(cueId: string, fixtureId: string): ResolvedLevel | null {
    return resolvedOfCue(cueId).find((item) => item.fixtureId === fixtureId) ?? null
  }

  function averageIntensityOfFixture(fixtureId: string): number | null {
    const matched: number[] = []
    resolvedByCue.value.forEach((items) => {
      const hit = items.find((item) => item.fixtureId === fixtureId)
      if (hit) matched.push(hit.intensity)
    })
    if (matched.length === 0) return null
    return Math.round(matched.reduce((sum, value) => sum + value, 0) / matched.length)
  }

  return {
    resolvedByCue,
    resolvedOfCue,
    resolvedLevelOf,
    averageIntensityOfFixture
  }
}
