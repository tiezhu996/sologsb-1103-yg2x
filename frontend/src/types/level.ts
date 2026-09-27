import type { FixturePosition } from '@/types/fixture'

/** 通道电平（CueLevel）：某条 Cue 下某个灯位通道的亮度与色温设定 */
export interface CueLevel {
  /** 主键 */
  id: string
  /** 所属 Cue */
  cueId: string
  /** 对应灯位通道 */
  fixtureId: string
  /** 亮度 0-100（%） */
  intensity: number
  /** 色温（K） */
  colorTempK: number
  /** 对焦说明 */
  focusNote: string
  updatedAt: number
}

/** 沿袭解析后的生效电平：本条自设优先，否则取上游最近一条自设电平 */
export interface ResolvedLevel {
  /** 生效的 Cue */
  cueId: string
  /** 对应灯位通道 */
  fixtureId: string
  /** 亮度 0-100（%） */
  intensity: number
  /** 色温（K） */
  colorTempK: number
  /** 对焦说明 */
  focusNote: string
  /** 取值来源：own=本条手动设置；inherited=沿袭上游 */
  source: 'own' | 'inherited'
  /** 沿袭来源 Cue 的 id（source 为 own 时为 null） */
  sourceCueId: string | null
}

/** 色温校验的单通道结果 */
export interface ColorTempItem {
  fixtureId: string
  channel: number
  position: FixturePosition
  colorTempK: number
  /** 相对基准色温的偏移量（K） */
  driftK: number
  consistent: boolean
}

/** 色温一致性校验结果 */
export interface ColorTempCheck {
  /** 出现次数最多的色温，作为基准 */
  dominantK: number
  /** 允许容差（K） */
  toleranceK: number
  items: ColorTempItem[]
  consistent: boolean
  message: string
}

/** 色温取值范围与容差 */
export const COLOR_TEMP_MIN = 2700
export const COLOR_TEMP_MAX = 6500
export const COLOR_TEMP_STEP = 100
export const COLOR_TEMP_TOLERANCE_K = 400

/** 亮度取值范围 */
export const INTENSITY_MIN = 0
export const INTENSITY_MAX = 100
