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
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, RotateCw } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getTokenUsageHeatmap } from '@/features/dashboard/api'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

const dayCount = 365
const levelClasses = [
  'border-border/60 bg-muted/70',
  'border-chart-2/20 bg-chart-2/20',
  'border-chart-2/30 bg-chart-2/40',
  'border-chart-2/40 bg-chart-2/65',
  'border-chart-2/60 bg-chart-2',
] as const

interface HeatmapDay {
  date: Date
  dateKey: string
  inRange: boolean
  tokenUsed: number
}

function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59
  )
}

function buildWeeks(
  rangeStart: Date,
  rangeEnd: Date,
  usageByDate: Map<string, number>
): HeatmapDay[][] {
  const gridStart = new Date(rangeStart)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())
  const gridEnd = new Date(rangeEnd)
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()))

  const weeks: HeatmapDay[][] = []
  const cursor = new Date(gridStart)
  while (cursor <= gridEnd) {
    const week: HeatmapDay[] = []
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const date = new Date(cursor)
      date.setDate(cursor.getDate() + dayIndex)
      const dateKey = toDateKey(date)
      week.push({
        date,
        dateKey,
        inRange: date >= rangeStart && date <= rangeEnd,
        tokenUsed: usageByDate.get(dateKey) ?? 0,
      })
    }
    weeks.push(week)
    cursor.setDate(cursor.getDate() + 7)
  }
  return weeks
}

function getUsageLevel(value: number, maximum: number): number {
  if (value <= 0 || maximum <= 0) return 0
  return Math.max(
    1,
    Math.min(4, Math.ceil((Math.log1p(value) / Math.log1p(maximum)) * 4))
  )
}

export function TokenUsageHeatmap() {
  const { t, i18n } = useTranslation()
  const range = useMemo(() => {
    const end = endOfDay(new Date())
    const startDate = new Date(end)
    startDate.setDate(startDate.getDate() - (dayCount - 1))
    return { start: startOfDay(startDate), end }
  }, [])
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    []
  )

  const usageQuery = useQuery({
    queryKey: [
      'dashboard',
      'overview',
      'token-usage-heatmap',
      toDateKey(range.start),
      toDateKey(range.end),
      timezone,
    ],
    queryFn: async () => {
      const response = await getTokenUsageHeatmap({
        start_timestamp: Math.floor(range.start.getTime() / 1000),
        end_timestamp: Math.floor(range.end.getTime() / 1000),
        timezone,
      })
      if (!response.success) {
        throw new Error(response.message || 'Failed to load token usage')
      }
      return response.data ?? []
    },
    staleTime: 60 * 1000,
  })

  const usageByDate = useMemo(
    () =>
      new Map(
        (usageQuery.data ?? []).map((item) => [
          item.date,
          Number(item.token_used) || 0,
        ])
      ),
    [usageQuery.data]
  )
  const weeks = useMemo(
    () => buildWeeks(range.start, range.end, usageByDate),
    [range.end, range.start, usageByDate]
  )
  const weekGridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
    }),
    [weeks.length]
  )
  const monthLabels = useMemo(() => {
    const labels = new Map<number, Date>()
    weeks.forEach((week, weekIndex) => {
      const monthStart = week.find(
        (day) => day.inRange && day.date.getDate() === 1
      )
      if (monthStart) labels.set(weekIndex, monthStart.date)
    })

    const firstFullMonthIndex = labels.keys().next().value
    if (
      !labels.has(0) &&
      (firstFullMonthIndex === undefined || firstFullMonthIndex >= 4)
    ) {
      labels.set(0, range.start)
    }
    return labels
  }, [range.start, weeks])
  const totals = useMemo(() => {
    let tokenUsed = 0
    let activeDays = 0
    let maximum = 0
    for (const value of usageByDate.values()) {
      tokenUsed += value
      if (value > 0) activeDays++
      maximum = Math.max(maximum, value)
    }
    return { tokenUsed, activeDays, maximum }
  }, [usageByDate])

  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short' }),
    [locale]
  )
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short' }),
    [locale]
  )
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [locale]
  )
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale),
    [locale]
  )
  const weekdayLabels = useMemo(() => {
    const sunday = new Date(2026, 0, 4)
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(sunday)
      date.setDate(sunday.getDate() + index)
      return weekdayFormatter.format(date)
    })
  }, [weekdayFormatter])

  return (
    <div className='bg-card overflow-hidden rounded-2xl border shadow-xs'>
      <div className='flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 sm:px-5 sm:py-4'>
        <div className='flex min-w-0 items-start gap-3'>
          <span className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg border'>
            <CalendarDays className='size-4' aria-hidden='true' />
          </span>
          <div className='min-w-0'>
            <h3 className='text-sm font-semibold sm:text-base'>
              {t('Token consumption')}
            </h3>
            <p className='text-muted-foreground mt-0.5 text-xs sm:text-sm'>
              {t('Daily token consumption over the last 365 days')}
            </p>
          </div>
        </div>
        {!usageQuery.isLoading && !usageQuery.isError && (
          <div className='flex items-center gap-4 text-right'>
            <div>
              <div className='text-muted-foreground text-[11px] font-medium'>
                {t('Total tokens')}
              </div>
              <div className='text-sm font-semibold tabular-nums'>
                {formatCompactNumber(totals.tokenUsed, locale)}
              </div>
            </div>
            <div>
              <div className='text-muted-foreground text-[11px] font-medium'>
                {t('Active days')}
              </div>
              <div className='text-sm font-semibold tabular-nums'>
                {totals.activeDays}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className='p-4 sm:p-5'>
        {usageQuery.isLoading && (
          <div className='space-y-3'>
            <Skeleton className='h-4 w-48' />
            <Skeleton className='h-28 w-full' />
          </div>
        )}
        {usageQuery.isError && (
          <div className='flex min-h-28 flex-col items-center justify-center gap-3 text-center'>
            <p className='text-muted-foreground text-sm'>
              {t('Failed to load token usage')}
            </p>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => usageQuery.refetch()}
            >
              <RotateCw data-icon='inline-start' />
              {t('Retry')}
            </Button>
          </div>
        )}
        {!usageQuery.isLoading && !usageQuery.isError && (
          <TooltipProvider delay={100}>
            <div className='overflow-x-auto pb-1'>
              <div className='mx-auto w-full min-w-[44rem] max-w-[52rem] sm:min-w-[36rem]'>
                <div
                  className='mb-1 ml-8 grid gap-0.5'
                  style={weekGridStyle}
                >
                  {weeks.map((week, weekIndex) => {
                    const monthDate = monthLabels.get(weekIndex)
                    return (
                      <div
                        key={week[0].dateKey}
                        className='relative h-4 min-w-0'
                      >
                        {monthDate && (
                          <span className='text-muted-foreground absolute top-0 left-0 text-[10px] whitespace-nowrap'>
                            {monthFormatter.format(monthDate)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className='flex gap-2'>
                  <div className='grid w-6 shrink-0 grid-rows-7 gap-[3px]'>
                    {weekdayLabels.map((label, index) => (
                      <span
                        key={label}
                        className='text-muted-foreground flex h-3 items-center text-[9px]'
                      >
                        {index % 2 === 1 ? label : ''}
                      </span>
                    ))}
                  </div>
                  <div
                    className='grid min-w-0 flex-1 gap-0.5'
                    style={weekGridStyle}
                  >
                    {weeks.map((week) => (
                      <div
                        key={week[0].dateKey}
                        className='grid min-w-0 grid-rows-7 gap-0.5'
                      >
                        {week.map((day) => {
                          if (!day.inRange) {
                            return (
                              <span
                                key={day.dateKey}
                                className='aspect-square w-full min-w-0'
                                aria-hidden='true'
                              />
                            )
                          }
                          const level = getUsageLevel(
                            day.tokenUsed,
                            totals.maximum
                          )
                          const label = t('{{tokens}} tokens on {{date}}', {
                            tokens: numberFormatter.format(day.tokenUsed),
                            date: dateFormatter.format(day.date),
                          })
                          return (
                            <Tooltip key={day.dateKey}>
                              <TooltipTrigger
                                render={
                                  <button
                                    type='button'
                                    tabIndex={day.tokenUsed > 0 ? 0 : -1}
                                    aria-label={label}
                                    className={cn(
                                      'aspect-square w-full min-w-0 rounded-[2px] border transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                      levelClasses[level]
                                    )}
                                  />
                                }
                              />
                              <TooltipContent>{label}</TooltipContent>
                            </Tooltip>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                <div className='text-muted-foreground mt-3 flex items-center justify-end gap-1.5 text-[10px]'>
                  <span>{t('Less')}</span>
                  {levelClasses.map((className) => (
                    <span
                      key={className}
                      className={cn('size-3 rounded-[3px] border', className)}
                      aria-hidden='true'
                    />
                  ))}
                  <span>{t('More')}</span>
                </div>
              </div>
            </div>
          </TooltipProvider>
        )}
      </div>
    </div>
  )
}
