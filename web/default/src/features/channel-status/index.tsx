/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, RadioTower } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CHANNEL_STATUS } from '@/features/channels/constants'
import {
  formatRelativeTime,
  formatResponseTime,
  getChannelTypeIcon,
  getChannelTypeLabel,
} from '@/features/channels/lib/channel-utils'
import { toIntlLocale } from '@/i18n/languages'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import { getChannelStatuses } from './api'
import type { ChannelStatus, ChannelStatusCheck } from './types'

const REFRESH_INTERVAL = 60 * 1000
const EMPTY_STATUSES: ChannelStatus[] = []

export function ChannelStatusPage() {
  const { t } = useTranslation()
  const statusesQuery = useQuery({
    queryKey: ['channel-status'],
    queryFn: getChannelStatuses,
    refetchInterval: REFRESH_INTERVAL,
    staleTime: 30 * 1000,
    retry: false,
  })
  const statuses = statusesQuery.data?.data ?? EMPTY_STATUSES
  const summary = useMemo(() => summarizeStatuses(statuses), [statuses])
  let channelContent: ReactNode
  if (statusesQuery.isLoading) {
    channelContent = <ChannelStatusSkeleton />
  } else if (statusesQuery.isError) {
    channelContent = (
      <div className='text-muted-foreground rounded-xl border border-dashed px-4 py-12 text-center text-sm'>
        {t('Unable to load channel status')}
      </div>
    )
  } else if (statuses.length === 0) {
    channelContent = (
      <div className='text-muted-foreground rounded-xl border border-dashed px-4 py-12 text-center text-sm'>
        {t('No channel status data available')}
      </div>
    )
  } else {
    channelContent = (
      <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
        {statuses.map((channel) => (
          <ChannelStatusCard key={channel.id} channel={channel} />
        ))}
      </div>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='flex items-center gap-2'>
          <RadioTower className='text-primary size-4' />
          <span>{t('Channel Status')}</span>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={() => statusesQuery.refetch()}
          disabled={statusesQuery.isFetching}
        >
          <RefreshCw
            className={cn('size-4', statusesQuery.isFetching && 'animate-spin')}
          />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <StatusSummary summary={summary} />

          {channelContent}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

type StatusSummaryValue = {
  total: number
  operational: number
  attention: number
}

function summarizeStatuses(statuses: ChannelStatus[]): StatusSummaryValue {
  return statuses.reduce<StatusSummaryValue>(
    (summary, channel) => {
      summary.total += 1
      if (channel.status === CHANNEL_STATUS.ENABLED) {
        summary.operational += 1
      } else {
        summary.attention += 1
      }
      return summary
    },
    { total: 0, operational: 0, attention: 0 }
  )
}

function StatusSummary(props: { summary: StatusSummaryValue }) {
  const { t } = useTranslation()
  const metrics = [
    { label: t('Total channels'), value: props.summary.total },
    { label: t('Operational'), value: props.summary.operational },
    { label: t('Needs attention'), value: props.summary.attention },
  ]

  return (
    <div className='grid grid-cols-3 gap-2 sm:gap-3'>
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className='bg-card rounded-xl border px-3 py-3 sm:px-4'
        >
          <p className='text-muted-foreground truncate text-xs font-medium'>
            {metric.label}
          </p>
          <p className='text-foreground mt-1 font-mono text-xl font-semibold tabular-nums'>
            {metric.value}
          </p>
        </div>
      ))}
    </div>
  )
}

function ChannelStatusCard(props: { channel: ChannelStatus }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const status = getStatusPresentation(props.channel.status, t)
  const iconName = getChannelTypeIcon(props.channel.type)
  const models = props.channel.models.slice(0, 3)
  const remainingModels = props.channel.models.length - models.length

  return (
    <article className='bg-card text-card-foreground hover:border-primary/40 overflow-hidden rounded-xl border transition-colors'>
      <div className='flex items-start justify-between gap-3 border-b px-4 py-4'>
        <div className='flex min-w-0 items-center gap-3'>
          <span className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg'>
            {getLobeIcon(`${iconName}.Color`, 22)}
          </span>
          <div className='min-w-0'>
            <h3 className='truncate text-sm font-semibold'>
              {props.channel.name}
            </h3>
            <p className='text-muted-foreground mt-0.5 truncate text-xs'>
              {t(getChannelTypeLabel(props.channel.type))}
            </p>
          </div>
        </div>
        <StatusBadge
          label={status.label}
          variant={status.variant}
          icon={status.icon}
          copyable={false}
          showDot
        />
      </div>

      <div className='grid grid-cols-2 divide-x px-4 py-3'>
        <Metric
          label={t('Response time')}
          value={formatResponseTime(props.channel.response_time, t)}
        />
        <Metric
          label={t('Last checked')}
          value={formatRelativeTime(props.channel.test_time, locale)}
        />
      </div>

      <CheckHistory checks={props.channel.checks} />

      <div className='bg-muted/30 min-h-14 border-t px-4 py-3'>
        <p className='text-muted-foreground mb-1 text-[11px] font-medium tracking-wide uppercase'>
          {t('Available models')}
        </p>
        {models.length > 0 ? (
          <div className='flex flex-wrap items-center gap-1.5'>
            {models.map((model) => (
              <span
                key={model}
                className='bg-background text-muted-foreground max-w-full truncate rounded-md border px-1.5 py-0.5 font-mono text-[11px]'
              >
                {model}
              </span>
            ))}
            {remainingModels > 0 && (
              <span className='text-muted-foreground text-[11px]'>
                +{remainingModels}
              </span>
            )}
          </div>
        ) : (
          <span className='text-muted-foreground text-xs'>
            {t('No models listed')}
          </span>
        )}
      </div>
    </article>
  )
}

function CheckHistory(props: { checks: ChannelStatusCheck[] }) {
  const { t } = useTranslation()
  const recordedChecks = props.checks ?? []
  const checks =
    recordedChecks.length > 0 ? recordedChecks : createUnknownChecks()

  return (
    <div className='border-t px-4 py-3'>
      <div className='mb-2 flex items-center justify-between gap-3'>
        <p className='text-muted-foreground truncate text-[11px] font-medium'>
          {t('Recent checks')}
        </p>
        <span className='text-muted-foreground shrink-0 font-mono text-[10px] tabular-nums'>
          {t('{{count}} checks', { count: recordedChecks.length })}
        </span>
      </div>
      <div
        className='flex h-5 items-end gap-px'
        role='img'
        aria-label={t('Recent channel checks')}
      >
        {checks.map((check) => (
          <span
            key={`${check.checked_at}-${check.status}-${check.response_time}`}
            className={cn(
              'min-w-0 flex-1 rounded-sm transition-opacity hover:opacity-70',
              getCheckBarClass(check.status),
              check.status === 0 ? 'h-3' : 'h-5'
            )}
            title={getCheckBarTitle(check, t)}
          />
        ))}
      </div>
      <div className='text-muted-foreground mt-1 flex justify-between text-[10px] tracking-wide uppercase'>
        <span>{t('Past')}</span>
        <span>{t('Now')}</span>
      </div>
    </div>
  )
}

function createUnknownChecks(): ChannelStatusCheck[] {
  return Array.from({ length: 12 }, (_, index) => ({
    status: 0,
    response_time: 0,
    checked_at: -(index + 1),
  }))
}

function getCheckBarClass(status: number): string {
  if (status === CHANNEL_STATUS.ENABLED) return 'bg-emerald-500'
  if (status === CHANNEL_STATUS.AUTO_DISABLED) return 'bg-rose-500'
  if (status === CHANNEL_STATUS.MANUAL_DISABLED) return 'bg-amber-400'
  return 'bg-muted-foreground/30'
}

function getCheckBarTitle(
  check: ChannelStatusCheck,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const status = getStatusPresentation(check.status, t)
  if (check.checked_at <= 0) return status.label
  return `${status.label} - ${formatResponseTime(check.response_time, t)}`
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className='min-w-0 px-2 first:pl-0 last:pr-0'>
      <p className='text-muted-foreground truncate text-[11px]'>
        {props.label}
      </p>
      <p className='text-foreground mt-1 truncate font-mono text-sm font-semibold tabular-nums'>
        {props.value}
      </p>
    </div>
  )
}

function getStatusPresentation(
  status: number,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (status === CHANNEL_STATUS.ENABLED) {
    return {
      label: t('Operational'),
      variant: 'success' as const,
      icon: undefined,
    }
  }
  if (status === CHANNEL_STATUS.AUTO_DISABLED) {
    return {
      label: t('Degraded'),
      variant: 'warning' as const,
      icon: undefined,
    }
  }
  if (status === CHANNEL_STATUS.MANUAL_DISABLED) {
    return {
      label: t('Disabled'),
      variant: 'neutral' as const,
      icon: undefined,
    }
  }
  return {
    label: t('Unknown'),
    variant: 'danger' as const,
    icon: undefined,
  }
}

function ChannelStatusSkeleton() {
  return (
    <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className='bg-card space-y-4 rounded-xl border p-4'>
          <div className='flex items-center gap-3'>
            <Skeleton className='size-9 rounded-lg' />
            <div className='space-y-1.5'>
              <Skeleton className='h-4 w-32' />
              <Skeleton className='h-3 w-20' />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <Skeleton className='h-10' />
            <Skeleton className='h-10' />
          </div>
          <Skeleton className='h-8 w-full' />
        </div>
      ))}
    </div>
  )
}
