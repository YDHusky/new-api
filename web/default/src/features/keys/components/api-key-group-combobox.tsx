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
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { MultiSelect } from '@/components/multi-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export type ApiKeyGroupOption = {
  value: string
  label: string
  desc?: string
  ratio?: number | string
}

type ApiKeyGroupSelectorProps = {
  options: ApiKeyGroupOption[]
  values: string[]
  onValuesChange: (values: string[]) => void
  disabled?: boolean
}

const maxGroups = 10

export function ApiKeyGroupSelector(props: ApiKeyGroupSelectorProps) {
  const { t } = useTranslation()
  const optionsByValue = new Map(
    props.options.map((option) => [option.value, option])
  )

  const handleSelectionChange = (next: string[]) => {
    const added = next.find((group) => !props.values.includes(group))
    if (added === 'auto') {
      props.onValuesChange(['auto'])
      return
    }
    const withoutAuto = added ? next.filter((group) => group !== 'auto') : next
    props.onValuesChange(withoutAuto.slice(0, maxGroups))
  }

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= props.values.length) return
    const next = [...props.values]
    ;[next[index], next[target]] = [next[target], next[index]]
    props.onValuesChange(next)
  }

  const remove = (group: string) => {
    props.onValuesChange(props.values.filter((item) => item !== group))
  }

  return (
    <div className='flex flex-col gap-2'>
      <MultiSelect
        options={props.options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        selected={props.values}
        onChange={handleSelectionChange}
        placeholder={t('Select groups')}
        disabled={props.disabled}
        maxVisibleChips={3}
      />

      {props.values.length > 1 && (
        <div className='border-border divide-border divide-y rounded-md border'>
          {props.values.map((group, index) => {
            const option = optionsByValue.get(group)
            return (
              <div
                key={group}
                className='grid min-h-14 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5'
              >
                <Badge
                  variant='outline'
                  className='justify-center tabular-nums'
                >
                  {index + 1}
                </Badge>
                <div className='min-w-0'>
                  <p className='truncate text-sm font-medium'>
                    {option?.label ?? group}
                  </p>
                  <p className='text-muted-foreground truncate text-xs'>
                    {option?.desc ?? group}
                  </p>
                </div>
                <div className='flex items-center gap-1'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    disabled={props.disabled || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={t('Move group up')}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    disabled={
                      props.disabled || index === props.values.length - 1
                    }
                    onClick={() => move(index, 1)}
                    aria-label={t('Move group down')}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    disabled={props.disabled}
                    onClick={() => remove(group)}
                    aria-label={t('Remove group')}
                  >
                    <X />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
