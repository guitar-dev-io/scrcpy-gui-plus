import { useCallback, useEffect, useMemo, useState } from 'react'

interface UseDeviceSelectionOptions {
  registeredDeviceIds: string[]
  initialSelectedDeviceIds?: string[]
}

/**
 * Owns batch-selection state independently from the focused active device.
 * Callers should pass every registry ID, including offline devices, so a
 * temporary disconnect does not clear the user's selection.
 */
export function useDeviceSelection({
  registeredDeviceIds,
  initialSelectedDeviceIds = [],
}: UseDeviceSelectionOptions) {
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(
    () =>
      new Set(
        initialSelectedDeviceIds.filter((serial) =>
          registeredDeviceIds.includes(serial),
        ),
      ),
  )

  const registeredIdSet = useMemo(
    () => new Set(registeredDeviceIds),
    [registeredDeviceIds],
  )

  useEffect(() => {
    setSelectedDeviceIds((current) => {
      const next = new Set(
        Array.from(current).filter((serial) => registeredIdSet.has(serial)),
      )
      return next.size === current.size ? current : next
    })
  }, [registeredIdSet])

  const toggleDeviceSelection = useCallback(
    (serial: string) => {
      if (!registeredIdSet.has(serial)) return
      setSelectedDeviceIds((current) => {
        const next = new Set(current)
        if (next.has(serial)) next.delete(serial)
        else next.add(serial)
        return next
      })
    },
    [registeredIdSet],
  )

  const selectAllDevices = useCallback(
    (serials: string[]) => {
      setSelectedDeviceIds(
        new Set(serials.filter((serial) => registeredIdSet.has(serial))),
      )
    },
    [registeredIdSet],
  )

  const clearDeviceSelection = useCallback(() => {
    setSelectedDeviceIds(new Set())
  }, [])

  return {
    selectedDeviceIds,
    toggleDeviceSelection,
    selectAllDevices,
    clearDeviceSelection,
  }
}
