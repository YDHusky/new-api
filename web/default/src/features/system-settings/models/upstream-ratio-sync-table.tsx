/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePagination, useDataTable } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { DifferencesMap, RatioType } from '../types'
import { RATIO_TYPE_OPTIONS } from './constants'
import { useUpstreamRatioSyncColumns } from './upstream-ratio-sync-columns'
import {
  getAlignedRatioTypes,
  getEffectiveResolutionSelections,
  getOrderedRatioTypes,
  getPreferredSyncField,
  getSyncFieldLabel,
  getUpstreamDisplayName,
  isSelectedResolutionValue,
  isSelectableUpstreamValue,
  RATIO_SYNC_FIELDS,
  type ModelRow,
  type ResolutionRemovalPlan,
  type ResolutionSelection,
  type ResolutionsMap,
} from './upstream-ratio-sync-helpers'

type UpstreamRatioSyncTableProps = {
  differences: DifferencesMap
  resolutions: ResolutionsMap
  isDisabled: boolean
  isSyncing: boolean
  onSelectValue: (
    model: string,
    ratioType: RatioType,
    value: number | string,
    sourceName: string
  ) => void
  onSelectValues: (selections: ResolutionSelection[]) => void
  onUnselectValue: (model: string, ratioType: RatioType) => void
  onUnselectValues: (plan: ResolutionRemovalPlan) => void
}

export type UpstreamBulkSelectState = {
  displayName: string
  selections: ResolutionSelection[]
  removalPlan: ResolutionRemovalPlan
  selectableCount: number
  selectedCount: number
}

export function UpstreamRatioSyncTable({
  differences,
  resolutions,
  isDisabled,
  isSyncing,
  onSelectValue,
  onSelectValues,
  onUnselectValue,
  onUnselectValues,
}: UpstreamRatioSyncTableProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [ratioTypeFilter, setRatioTypeFilter] = useState<string>('')
  const [selectedUpstream, setSelectedUpstream] = useState('')

  const dataSource = useMemo<ModelRow[]>(() => {
    return Object.entries(differences).map(([model, ratioTypes]) => {
      const hasPrice = 'model_price' in ratioTypes
      const hasOtherRatio = RATIO_SYNC_FIELDS.some((rt) => rt in ratioTypes)
      return {
        key: model,
        model,
        ratioTypes,
        billingConflict: hasPrice && hasOtherRatio,
      }
    })
  }, [differences])

  const filteredData = useMemo(() => {
    let data = dataSource

    if (search.trim()) {
      const lower = search.toLowerCase()
      data = data.filter((row) => row.model.toLowerCase().includes(lower))
    }

    if (ratioTypeFilter && ratioTypeFilter !== '__all__') {
      data = data.filter((row) => ratioTypeFilter in row.ratioTypes)
    }

    return data
  }, [dataSource, search, ratioTypeFilter])

  const upstreamNames = useMemo(() => {
    const set = new Set<string>()
    filteredData.forEach((row) => {
      getOrderedRatioTypes(row.ratioTypes, ratioTypeFilter).forEach(
        (ratioType) => {
          Object.keys(row.ratioTypes[ratioType]?.upstreams || {}).forEach(
            (name) => set.add(name)
          )
        }
      )
    })
    return [...set]
  }, [filteredData, ratioTypeFilter])

  useEffect(() => {
    if (upstreamNames.length > 0 && !upstreamNames.includes(selectedUpstream)) {
      setSelectedUpstream(upstreamNames[0])
    }
  }, [selectedUpstream, upstreamNames])

  const visibleUpstreamNames = useMemo(
    () => (selectedUpstream ? [selectedUpstream] : []),
    [selectedUpstream]
  )

  const bulkSelectStateByUpstream = useMemo<
    Record<string, UpstreamBulkSelectState>
  >(() => {
    return upstreamNames.reduce<Record<string, UpstreamBulkSelectState>>(
      (states, upstreamName) => {
        const selections: ResolutionSelection[] = []
        const removalPlan: ResolutionRemovalPlan = new Map()

        filteredData.forEach((row) => {
          getAlignedRatioTypes(
            row.ratioTypes,
            [upstreamName],
            ratioTypeFilter
          ).forEach((ratioType) => {
            const upstreamVal =
              row.ratioTypes[ratioType]?.upstreams?.[upstreamName]
            if (isSelectableUpstreamValue(upstreamVal)) {
              selections.push({
                model: row.model,
                ratioType,
                value: upstreamVal as number | string,
                sourceName: upstreamName,
              })
              const removalRatioTypes = removalPlan.get(row.model)
              if (removalRatioTypes) {
                removalRatioTypes.add(ratioType)
              } else {
                removalPlan.set(row.model, new Set([ratioType]))
              }
            }
          })
        })

        const effectiveSelections = getEffectiveResolutionSelections(
          differences,
          selections
        )
        const selectedCount = effectiveSelections.filter((selection) =>
          isSelectedResolutionValue(
            resolutions,
            selection.model,
            selection.ratioType,
            selection.value
          )
        ).length

        states[upstreamName] = {
          displayName: getUpstreamDisplayName(upstreamName),
          selections: effectiveSelections,
          removalPlan,
          selectableCount: effectiveSelections.length,
          selectedCount,
        }
        return states
      },
      {}
    )
  }, [differences, filteredData, ratioTypeFilter, resolutions, upstreamNames])

  const handleBulkSelect = useCallback(
    (upstream: string) => {
      const selections = bulkSelectStateByUpstream[upstream]?.selections ?? []
      onSelectValues(selections)
    },
    [bulkSelectStateByUpstream, onSelectValues]
  )

  const handleBulkUnselect = useCallback(
    (upstream: string) => {
      const removalPlan =
        bulkSelectStateByUpstream[upstream]?.removalPlan ?? new Map()
      onUnselectValues(removalPlan)
    },
    [bulkSelectStateByUpstream, onUnselectValues]
  )

  const columns = useUpstreamRatioSyncColumns(
    visibleUpstreamNames,
    bulkSelectStateByUpstream,
    resolutions,
    ratioTypeFilter,
    isDisabled,
    onSelectValue,
    onUnselectValue,
    handleBulkSelect,
    handleBulkUnselect
  )

  const { table } = useDataTable({
    data: filteredData,
    columns,
    getRowId: (row) => row.key,
    initialPagination: { pageIndex: 0, pageSize: 10 },
    withFilteredRowModel: false,
    withSortedRowModel: false,
    withFacetedRowModel: false,
  })

  if (dataSource.length === 0) {
    if (isSyncing) {
      return (
        <div className='flex h-64 flex-col items-center justify-center gap-3 rounded-md border'>
          <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
          <p className='text-muted-foreground text-sm'>
            {t('Fetching upstream prices...')}
          </p>
        </div>
      )
    }

    return (
      <div className='flex h-64 items-center justify-center rounded-md border'>
        <div className='text-center'>
          <p className='text-muted-foreground text-sm'>
            {t('No upstream price differences found')}
          </p>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Select sync channels to compare prices')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center'>
        <div className='relative flex-1'>
          <Search className='text-muted-foreground absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder={t('Search model name...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={isDisabled}
            className='ps-8'
          />
        </div>
        <Select
          items={[
            { value: '__all__', label: t('All Types') },
            ...RATIO_TYPE_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.label),
            })),
          ]}
          value={ratioTypeFilter}
          onValueChange={(v) => v !== null && setRatioTypeFilter(v)}
          disabled={isDisabled}
        >
          <SelectTrigger className='w-full sm:w-56'>
            <SelectValue placeholder={t('Filter by price field')} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              <SelectItem value='__all__'>{t('All Types')}</SelectItem>
              {RATIO_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.label)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={upstreamNames.map((name) => ({
            value: name,
            label: getUpstreamDisplayName(name),
          }))}
          value={selectedUpstream}
          onValueChange={(value) => setSelectedUpstream(value ?? '')}
          disabled={isDisabled || upstreamNames.length === 0}
        >
          <SelectTrigger className='w-full sm:w-80'>
            <SelectValue placeholder={t('Select Sync Source')} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {upstreamNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {getUpstreamDisplayName(name)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <div className='min-w-[780px]'>
          <div className='bg-muted/50 grid grid-cols-[minmax(180px,1fr)_minmax(240px,1fr)_minmax(280px,1.2fr)] gap-4 border-b px-3 py-3 text-sm font-medium'>
            <span>{t('Model')}</span>
            <span>{t('Current Price')}</span>
            <div className='flex items-center gap-2'>
              {selectedUpstream &&
                bulkSelectStateByUpstream[selectedUpstream]?.selectableCount >
                  0 && (
                  <Checkbox
                    checked={
                      bulkSelectStateByUpstream[selectedUpstream]
                        .selectedCount ===
                      bulkSelectStateByUpstream[selectedUpstream]
                        .selectableCount
                    }
                    indeterminate={
                      bulkSelectStateByUpstream[selectedUpstream]
                        .selectedCount > 0 &&
                      bulkSelectStateByUpstream[selectedUpstream]
                        .selectedCount <
                        bulkSelectStateByUpstream[selectedUpstream]
                          .selectableCount
                    }
                    disabled={isDisabled}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        handleBulkSelect(selectedUpstream)
                      } else {
                        handleBulkUnselect(selectedUpstream)
                      }
                    }}
                    aria-label={t('Select all (filtered)')}
                  />
                )}
              <span className='truncate'>
                {selectedUpstream
                  ? getUpstreamDisplayName(selectedUpstream)
                  : t('Select Sync Source')}
              </span>
            </div>
          </div>

          {table.getRowModel().rows.length === 0 ? (
            <div className='text-muted-foreground flex h-24 items-center justify-center text-sm'>
              {t('No results found')}
            </div>
          ) : (
            table.getRowModel().rows.map((tableRow) => {
              const row = tableRow.original
              const fields = getAlignedRatioTypes(
                row.ratioTypes,
                visibleUpstreamNames,
                ratioTypeFilter
              )

              return (
                <div
                  key={row.key}
                  className='grid grid-cols-[minmax(180px,1fr)_minmax(240px,1fr)_minmax(280px,1.2fr)] gap-4 border-b px-3 py-3 last:border-b-0'
                >
                  <div className='min-w-0 py-1'>
                    <p className='text-sm font-medium break-all'>{row.model}</p>
                  </div>
                  <div className='flex min-w-0 flex-col gap-2'>
                    {fields.map((ratioType) => {
                      const current = row.ratioTypes[ratioType]?.current
                      return (
                        <div
                          key={ratioType}
                          className='bg-muted/30 flex min-h-8 items-center gap-2 rounded px-2'
                        >
                          <StatusBadge
                            label={getSyncFieldLabel(ratioType, t)}
                            autoColor={ratioType}
                            size='sm'
                            copyable={false}
                            className='min-w-[4.5rem] shrink-0'
                          />
                          <span className='min-w-0 truncate text-sm'>
                            {current === null || current === undefined
                              ? t('Not Set')
                              : String(current)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <div className='flex min-w-0 flex-col gap-2'>
                    {fields.map((ratioType) => {
                      const difference = row.ratioTypes[ratioType]
                      const upstreamValue =
                        difference?.upstreams?.[selectedUpstream]
                      const isAvailable =
                        getPreferredSyncField(
                          row.ratioTypes,
                          ratioType,
                          selectedUpstream
                        ) === ratioType
                      const isSelectable =
                        isAvailable && isSelectableUpstreamValue(upstreamValue)
                      const isSelected = isSelectedResolutionValue(
                        resolutions,
                        row.model,
                        ratioType,
                        upstreamValue
                      )

                      return (
                        <div
                          key={ratioType}
                          className='bg-muted/30 flex min-h-8 items-center gap-2 rounded px-2'
                        >
                          <StatusBadge
                            label={getSyncFieldLabel(ratioType, t)}
                            autoColor={ratioType}
                            size='sm'
                            copyable={false}
                            className='min-w-[4.5rem] shrink-0'
                          />
                          {isSelectable ? (
                            <>
                              <Checkbox
                                checked={isSelected}
                                disabled={isDisabled}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    onSelectValue(
                                      row.model,
                                      ratioType,
                                      upstreamValue as number | string,
                                      selectedUpstream
                                    )
                                  } else {
                                    onUnselectValue(row.model, ratioType)
                                  }
                                }}
                                aria-label={t('Apply Sync')}
                              />
                              <span className='min-w-0 truncate font-mono text-sm'>
                                {String(upstreamValue)}
                              </span>
                            </>
                          ) : (
                            <span className='text-muted-foreground min-w-0 truncate text-sm'>
                              {upstreamValue === 'same'
                                ? t('Same as local')
                                : t('Not Set')}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className='shrink-0'>
        <DataTablePagination table={table} />
      </div>
    </div>
  )
}
