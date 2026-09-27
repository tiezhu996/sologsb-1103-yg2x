<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NInput, NInputNumber, NSlider, NSwitch, NTag, useMessage } from 'naive-ui'
import BlankHint from '@/components/common/BlankHint.vue'
import ChannelChip from '@/components/common/ChannelChip.vue'
import CueNoInput from '@/components/common/CueNoInput.vue'
import FadeBar from '@/components/common/FadeBar.vue'
import { useCueStore } from '@/stores/cueStore'
import { useFixtureStore } from '@/stores/fixtureStore'
import { useLevelStore } from '@/stores/levelStore'
import { useSessionStore } from '@/stores/sessionStore'
import type { Fixture, FixturePosition } from '@/types/fixture'
import { COLOR_TEMP_MAX, COLOR_TEMP_MIN, COLOR_TEMP_STEP } from '@/types/level'
import { cueTotalSeconds, checkColorTempConsistency, formatSeconds, formatTransition } from '@/utils/fade'
import { normalizeCueNo } from '@/utils/cueOrder'
import { resolveSessionLevels, resolvedLevelOf } from '@/utils/inherit'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const cueStore = useCueStore()
const fixtureStore = useFixtureStore()
const levelStore = useLevelStore()
const sessionStore = useSessionStore()

const cueId = computed(() => String(route.params.id ?? ''))
const cue = computed(() => cueStore.cueById(cueId.value))
const sessionId = computed(() => cue.value?.sessionId ?? '')
const session = computed(() => (sessionId.value ? sessionStore.sessionById(sessionId.value) : null))

const fixtures = computed(() => (sessionId.value ? fixtureStore.sortedFixturesOfSession(sessionId.value) : []))
/** 本条自设的通道电平 */
const levels = computed(() => levelStore.levelsOfCue(cueId.value))

const siblingCues = computed(() => (sessionId.value ? cueStore.sortedCuesOfSession(sessionId.value) : []))
const cueIndex = computed(() => siblingCues.value.findIndex((item) => item.id === cueId.value))
const isFirstCue = computed(() => cueIndex.value <= 0)
const inheritOn = computed(() => cue.value?.inheritLevels ?? false)

/** 沿袭解析后的生效电平：自设优先，未自设的通道跟随上游最近一条自设电平 */
const resolvedLevels = computed(() => {
  if (!cue.value) return []
  const resolved = resolveSessionLevels(siblingCues.value, (id) => levelStore.levelsOfCue(id))
  return resolved.get(cueId.value) ?? []
})

function resolvedOf(fixtureId: string) {
  return resolvedLevelOf(resolvedLevels.value, fixtureId)
}

const siblingNos = computed(() =>
  cue.value
    ? cueStore
        .cuesOfSession(sessionId.value)
        .map((item) => item.cueNo)
        .filter((no) => no !== cue.value?.cueNo)
    : []
)

/** 生效电平的通道（自设 + 沿袭，用于色温一致性判定） */
const tempItems = computed(() => {
  const items: Array<{ fixtureId: string; channel: number; position: FixturePosition; colorTempK: number }> = []
  resolvedLevels.value.forEach((level) => {
    const fixture = fixtureStore.fixtureById(level.fixtureId)
    if (!fixture) return
    items.push({
      fixtureId: level.fixtureId,
      channel: fixture.channel,
      position: fixture.position,
      colorTempK: level.colorTempK
    })
  })
  return items.sort((a, b) => a.channel - b.channel)
})

const tempCheck = computed(() => checkColorTempConsistency(tempItems.value))

const defaultTempK = computed(() => (tempCheck.value.dominantK > 0 ? tempCheck.value.dominantK : 3200))

function isEnabled(fixtureId: string): boolean {
  return levelStore.levelOf(cueId.value, fixtureId) !== null
}

/** 展示用亮度：自设优先，其次沿袭值 */
function intensityOf(fixtureId: string): number {
  return resolvedOf(fixtureId)?.intensity ?? 0
}

/** 展示用色温：自设优先，其次沿袭值 */
function tempOf(fixtureId: string): number {
  return resolvedOf(fixtureId)?.colorTempK ?? defaultTempK.value
}

/** 沿袭来源的 Cue 编号（仅沿袭中且非自设时有值） */
function inheritSourceNo(fixtureId: string): string | null {
  if (isEnabled(fixtureId)) return null
  const resolved = resolvedOf(fixtureId)
  if (!resolved || resolved.source !== 'inherited' || !resolved.sourceCueId) return null
  return cueStore.cueById(resolved.sourceCueId)?.cueNo ?? null
}

/** 色温列的状态文案：自设看漂移，沿袭看来源 */
function driftTextOf(fixtureId: string): string {
  if (isEnabled(fixtureId)) return `偏移 ${Math.abs(tempOf(fixtureId) - defaultTempK.value)}K`
  const sourceNo = inheritSourceNo(fixtureId)
  if (sourceNo) return `沿袭自 ${sourceNo}`
  return inheritOn.value ? '上游无可沿袭' : '未参与'
}

const focusDrafts = ref<Record<string, string>>({})

function focusValue(fixtureId: string): string {
  return focusDrafts.value[fixtureId] ?? resolvedOf(fixtureId)?.focusNote ?? ''
}

function onFocusInput(fixtureId: string, value: string): void {
  focusDrafts.value = { ...focusDrafts.value, [fixtureId]: value }
}

async function commitFocus(fixtureId: string): Promise<void> {
  const draft = focusDrafts.value[fixtureId]
  if (draft === undefined) return
  const next = { ...focusDrafts.value }
  delete next[fixtureId]
  focusDrafts.value = next
  if (!isEnabled(fixtureId)) return
  await levelStore.upsertLevel(cueId.value, fixtureId, { focusNote: draft })
}

async function toggleFixture(fixture: Fixture, enabled: boolean): Promise<void> {
  if (enabled) {
    // 开启「本条自设」时以当前生效值（含沿袭值）为起点，随后手动调整即覆盖沿袭
    const resolved = resolvedOf(fixture.id)
    await levelStore.upsertLevel(cueId.value, fixture.id, {
      intensity: resolved?.intensity ?? 70,
      colorTempK: resolved?.colorTempK ?? defaultTempK.value,
      focusNote: focusValue(fixture.id)
    })
    return
  }
  // 关闭自设：开启沿袭的 Cue 回落为跟随上游，未开启则不再参与本 Cue
  await levelStore.removeLevel(cueId.value, fixture.id)
}

async function setIntensity(fixtureId: string, value: number): Promise<void> {
  await levelStore.upsertLevel(cueId.value, fixtureId, { intensity: value })
}

async function setColorTemp(fixtureId: string, value: number | null): Promise<void> {
  if (value === null) return
  await levelStore.upsertLevel(cueId.value, fixtureId, { colorTempK: value })
}

/** 对齐基准色温：对全部生效通道落为本条自设（沿袭中的通道随之转为自设） */
async function alignToDominant(): Promise<void> {
  if (resolvedLevels.value.length === 0) return
  const target = tempCheck.value.dominantK
  await Promise.all(
    resolvedLevels.value.map((level) =>
      levelStore.upsertLevel(cueId.value, level.fixtureId, {
        intensity: level.intensity,
        colorTempK: target,
        focusNote: level.focusNote
      })
    )
  )
  message.success(`已将 ${resolvedLevels.value.length} 个通道对齐到 ${target}K`)
}

/** 清空本条自设电平；开启沿袭时清空后回落为跟随上游 */
async function clearAll(): Promise<void> {
  const count = levels.value.length
  await levelStore.removeByCue(cueId.value)
  message.success(`已清空 ${count} 个通道电平`)
}

/** 切换「沿袭上一条」开关 */
async function toggleInherit(enabled: boolean): Promise<void> {
  if (!cue.value || cue.value.inheritLevels === enabled) return
  await cueStore.updateCue(cue.value.id, { inheritLevels: enabled })
  message.success(enabled ? '已开启沿袭：未自设的通道跟随上游最近一条自设电平' : '已关闭沿袭，本 Cue 仅使用本条自设电平')
}

async function commitCueNo(value: string): Promise<void> {
  if (!cue.value) return
  const normalized = normalizeCueNo(value)
  if (normalized === cue.value.cueNo) return
  if (cueStore.isCueNoTaken(sessionId.value, normalized, cue.value.id)) {
    message.error(`${normalized} 已被占用`)
    return
  }
  await cueStore.updateCue(cue.value.id, { cueNo: normalized })
  message.success(`编号已改为 ${normalized}`)
}

function goSiblingCue(direction: -1 | 1): void {
  if (!cue.value) return
  const index = siblingCues.value.findIndex((item) => item.id === cue.value?.id)
  const next = siblingCues.value[index + direction]
  if (!next) {
    message.warning(direction === -1 ? '已经是第一条 Cue' : '已经是最后一条 Cue')
    return
  }
  void router.push(`/cues/${next.id}/levels`)
}

function goTimeline(): void {
  void router.push(`/sessions/${sessionId.value}/cues`)
}

function goFixtures(): void {
  void router.push(`/sessions/${sessionId.value}/fixtures`)
}

function goSheets(): void {
  void router.push('/sheets')
}
</script>

<template>
  <div class="page">
    <header class="page__header">
      <div>
        <h1 class="page__title">通道电平编辑</h1>
        <p class="page__subtitle">
          {{ session ? `${session.order}. ${session.title}` : '所属场次不存在' }} ·
          逐通道设定亮度与色温，超出容差的色温漂移会被提示。
        </p>
      </div>
      <div class="page__actions">
        <NButton @click="goTimeline">返回 Cue 时间轴</NButton>
        <NButton @click="goFixtures">灯位通道</NButton>
        <NButton @click="goSheets">排演表</NButton>
      </div>
    </header>

    <NAlert v-if="!cue" type="warning" :bordered="false">
      该 Cue 不存在，可能已被删除。请返回 Cue 编排时间轴重新选择。
    </NAlert>

    <template v-else>
      <section class="panel">
        <div class="cue-head">
          <CueNoInput :model-value="cue.cueNo" :existing-nos="siblingNos" width="130px" @commit="commitCueNo" />
          <div class="cue-head__titles">
            <p class="cue-head__label">{{ cue.label || '（未填写提示语）' }}</p>
            <p class="cue-head__meta mono">{{ formatTransition(cue) }} · 合计 {{ formatSeconds(cueTotalSeconds(cue)) }}</p>
          </div>
          <NTag size="small" :bordered="false" type="warning">{{ cue.trigger }}</NTag>
          <label
            class="inherit-toggle"
            :title="
              isFirstCue
                ? '第一条 Cue 没有可沿袭的上一条'
                : '开启后，本条未自设的通道跟随上游最近一条自设电平，上游调整时同步生效'
            "
          >
            <NSwitch
              :value="cue.inheritLevels"
              size="small"
              :disabled="isFirstCue"
              @update:value="(value) => toggleInherit(value === true)"
            />
            <span class="inherit-toggle__label">沿袭上一条</span>
          </label>
          <span class="toolbar__spacer" />
          <NButton size="small" quaternary @click="goSiblingCue(-1)">上一条 Cue</NButton>
          <NButton size="small" quaternary @click="goSiblingCue(1)">下一条 Cue</NButton>
        </div>

        <div class="cue-head__bar">
          <FadeBar :fade-in-sec="cue.fadeInSec" :hold-sec="cue.holdSec" :fade-out-sec="cue.fadeOutSec" :height="14" />
        </div>
      </section>

      <NAlert :type="tempCheck.consistent ? 'success' : 'warning'" :bordered="false">
        {{ tempCheck.message }}
      </NAlert>

      <div class="toolbar">
        <span class="toolbar__label">
          生效 {{ resolvedLevels.length }} / {{ fixtures.length }} 个通道<template v-if="inheritOn"
            >（本条自设 {{ levels.length }} 个，其余沿袭上游）</template
          >
        </span>
        <span class="toolbar__spacer" />
        <NButton size="small" :disabled="resolvedLevels.length === 0" @click="alignToDominant">
          全部对齐到 {{ defaultTempK }}K
        </NButton>
        <NButton size="small" quaternary type="error" :disabled="levels.length === 0" @click="clearAll">
          {{ inheritOn ? '清空本条自设电平' : '清空本 Cue 电平' }}
        </NButton>
      </div>

      <BlankHint
        v-if="fixtures.length === 0"
        title="该场次还没有灯位通道"
        description="通道电平需要先有灯位通道。请到灯位通道配置台完成配接后回来设定亮度与色温。"
        action-text="去配置灯位通道"
        @action="goFixtures"
      />

      <section v-else class="panel">
        <h2 class="panel__title">
          通道电平<span class="panel__title-tag">{{
            inheritOn ? '开关控制该通道是否本条自设，关闭时沿袭上游最近一条自设电平' : '开关控制该通道是否参与本 Cue'
          }}</span>
        </h2>

        <div class="level-table">
          <div class="level-table__head">
            <span>参与</span>
            <span>通道</span>
            <span>亮度</span>
            <span>色温</span>
            <span>对焦说明</span>
          </div>

          <div
            v-for="fixture in fixtures"
            :key="fixture.id"
            class="level-row"
            :class="{
              'level-row--off': !isEnabled(fixture.id),
              'level-row--inherited': inheritSourceNo(fixture.id) !== null
            }"
          >
            <NSwitch
              :value="isEnabled(fixture.id)"
              size="small"
              @update:value="(value) => toggleFixture(fixture, value === true)"
            />

            <div class="level-row__chip">
              <ChannelChip
                :channel="fixture.channel"
                :position="fixture.position"
                :intensity="resolvedOf(fixture.id) ? intensityOf(fixture.id) : null"
                :inherited="inheritSourceNo(fixture.id) !== null"
                :gel="fixture.gel"
                :fixture-type="fixture.fixtureType"
                size="small"
              />
              <span class="level-row__type">{{ fixture.fixtureType }}</span>
            </div>

            <div class="level-row__control">
              <NSlider
                :value="intensityOf(fixture.id)"
                :min="0"
                :max="100"
                :step="1"
                :disabled="!isEnabled(fixture.id)"
                @update:value="(value) => setIntensity(fixture.id, value)"
              />
              <NInputNumber
                :value="intensityOf(fixture.id)"
                size="small"
                :min="0"
                :max="100"
                :show-button="false"
                :disabled="!isEnabled(fixture.id)"
                style="width: 82px"
                @update:value="(value) => setIntensity(fixture.id, value ?? 0)"
              />
            </div>

            <div class="level-row__control">
              <NInputNumber
                :value="tempOf(fixture.id)"
                size="small"
                :min="COLOR_TEMP_MIN"
                :max="COLOR_TEMP_MAX"
                :step="COLOR_TEMP_STEP"
                :disabled="!isEnabled(fixture.id)"
                style="width: 108px"
                @update:value="(value) => setColorTemp(fixture.id, value)"
              />
              <span class="level-row__drift mono">{{ driftTextOf(fixture.id) }}</span>
            </div>

            <NInput
              :value="focusValue(fixture.id)"
              size="small"
              :disabled="!isEnabled(fixture.id)"
              placeholder="对焦说明（失焦保存）"
              @update:value="(value) => onFocusInput(fixture.id, value)"
              @blur="commitFocus(fixture.id)"
              @keyup.enter="commitFocus(fixture.id)"
            />
          </div>
        </div>
      </section>

      <section v-if="tempItems.length > 0" class="panel">
        <h2 class="panel__title">色温一致性检查<span class="panel__title-tag">容差 ±{{ tempCheck.toleranceK }}K</span></h2>
        <div class="temp-grid">
          <div
            v-for="item in tempCheck.items"
            :key="item.fixtureId"
            class="temp-item"
            :class="{ 'temp-item--drift': !item.consistent }"
          >
            <ChannelChip :channel="item.channel" :position="item.position" :intensity="null" size="small" />
            <span class="mono">{{ item.colorTempK }}K</span>
            <span class="temp-item__drift mono">偏移 {{ item.driftK }}K</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.cue-head {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.cue-head__titles {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
}

.cue-head__label {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.cue-head__meta {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.cue-head__bar {
  margin-top: 14px;
  max-width: 620px;
}

.toolbar__label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.level-table__head,
.level-row {
  display: grid;
  grid-template-columns: 58px 220px 240px 220px 1fr;
  align-items: center;
  gap: 12px;
  padding: 9px 4px;
}

.level-table__head {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.42);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.level-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: opacity 0.16s ease;
}

.level-row--off {
  opacity: 0.5;
}

.level-row--off.level-row--inherited {
  opacity: 0.85;
}

.inherit-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  cursor: pointer;
  user-select: none;
}

.inherit-toggle__label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
}

.level-row__chip {
  display: flex;
  align-items: center;
  gap: 8px;
}

.level-row__type {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.level-row__control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.level-row__drift {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.42);
  white-space: nowrap;
}

.temp-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.temp-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 10px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.temp-item--drift {
  border-color: rgba(232, 168, 84, 0.65);
  background: rgba(232, 168, 84, 0.1);
}

.temp-item__drift {
  color: rgba(255, 255, 255, 0.5);
}
</style>
