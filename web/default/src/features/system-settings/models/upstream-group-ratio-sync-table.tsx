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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import type { RatioDifference } from '../types'

export type GroupRatioResolution = {
  value: number
  sourceName: string
}

type UpstreamGroupRatioSyncTableProps = {
  differences: Record<string, RatioDifference>
  resolutions: Record<string, GroupRatioResolution>
  isDisabled: boolean
  onSelectValue: (group: string, resolution: GroupRatioResolution) => void
  onUnselectValue: (group: string) => void
}

function formatRatio(value: number | string | null): string {
  return value === null ? '-' : String(value)
}

export function UpstreamGroupRatioSyncTable(
  props: UpstreamGroupRatioSyncTableProps
) {
  const { t } = useTranslation()
  const entries = useMemo(
    () =>
      Object.entries(props.differences).sort(([a], [b]) => a.localeCompare(b)),
    [props.differences]
  )

  if (entries.length === 0) {
    return (
      <div className='text-muted-foreground flex h-36 items-center justify-center rounded-md border text-sm'>
        {t('No upstream group differences found')}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('Group')}</TableHead>
          <TableHead>{t('Current ratio')}</TableHead>
          <TableHead>{t('Upstream ratio')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map(([group, difference]) => {
          const selectableSources = Object.entries(difference.upstreams).filter(
            ([, value]) => typeof value === 'number'
          ) as Array<[string, number]>
          const selected = props.resolutions[group]
          const items = [
            { value: '__none__', label: t('Do not sync') },
            ...selectableSources.map(([sourceName, value]) => ({
              value: sourceName,
              label: `${sourceName}: ${formatRatio(value)}`,
            })),
          ]

          return (
            <TableRow key={group}>
              <TableCell className='font-medium'>{group}</TableCell>
              <TableCell>{formatRatio(difference.current)}</TableCell>
              <TableCell className='min-w-72'>
                <Select
                  items={items}
                  value={selected?.sourceName ?? '__none__'}
                  onValueChange={(sourceName) => {
                    if (!sourceName || sourceName === '__none__') {
                      props.onUnselectValue(group)
                      return
                    }
                    const value = difference.upstreams[sourceName]
                    if (typeof value === 'number') {
                      props.onSelectValue(group, { value, sourceName })
                    }
                  }}
                  disabled={props.isDisabled || selectableSources.length === 0}
                >
                  <SelectTrigger aria-label={t('Select group ratio')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='__none__'>
                        {t('Do not sync')}
                      </SelectItem>
                      {selectableSources.map(([sourceName, value]) => (
                        <SelectItem key={sourceName} value={sourceName}>
                          {sourceName}: {formatRatio(value)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
