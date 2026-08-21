import type { PublicMenuOption, PublicMenuOptionGroup } from '@/api/publicMenu'

export function getOptionQuantity(selectedOptionIds: string[], optionId: string) {
  return selectedOptionIds.filter((selectedOptionId) => selectedOptionId === optionId).length
}

/** Group limits count different choices; repeated quantities are limited by each option. */
export function getSelectedCountInGroup(
  selectedOptionIds: string[],
  group: PublicMenuOptionGroup,
) {
  const groupOptionIds = new Set(group.options.map((option) => option.id))
  return new Set(selectedOptionIds.filter((optionId) => groupOptionIds.has(optionId))).size
}

export function setOptionQuantity(
  selectedOptionIds: string[],
  group: PublicMenuOptionGroup,
  option: PublicMenuOption,
  nextQuantity: number,
) {
  if (group.maxSelections <= 1) {
    const groupOptionIds = new Set(group.options.map((entry) => entry.id))
    const withoutGroup = selectedOptionIds.filter((optionId) => !groupOptionIds.has(optionId))
    const clampedQuantity = Math.max(0, Math.min(nextQuantity, option.maxQuantity))
    return clampedQuantity > 0
      ? [...withoutGroup, ...Array.from({ length: clampedQuantity }, () => option.id)]
      : withoutGroup
  }

  const currentQuantity = getOptionQuantity(selectedOptionIds, option.id)
  const selectedInGroup = getSelectedCountInGroup(selectedOptionIds, group)
  const canSelectOption = currentQuantity > 0 || selectedInGroup < group.maxSelections
  const clampedQuantity = canSelectOption
    ? Math.max(0, Math.min(nextQuantity, option.maxQuantity))
    : 0
  const withoutOption = selectedOptionIds.filter((optionId) => optionId !== option.id)

  return [
    ...withoutOption,
    ...Array.from({ length: clampedQuantity }, () => option.id),
  ]
}
