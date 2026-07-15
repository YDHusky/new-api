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
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Save } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'

import {
  getRatioSyncAccountKeys,
  getRatioSyncAccounts,
  getRatioSyncAutoConfig,
  getRatioSyncLogs,
  runRatioSyncNow,
  updateRatioSyncAutoConfig,
} from '../api'
import type { RatioSyncAutoConfig } from '../types'

const defaultConfig: RatioSyncAutoConfig = {
  enabled: false,
  account_id: '',
  interval_minutes: 60,
  key_mappings: [],
}

type UpstreamRatioAutoSyncProps = {
  localGroups: string[]
}

export function UpstreamRatioAutoSync(props: UpstreamRatioAutoSyncProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [config, setConfig] = useState(defaultConfig)

  const { data: accountsData } = useQuery({
    queryKey: ['ratio-sync-accounts'],
    queryFn: getRatioSyncAccounts,
  })
  const { data: configData } = useQuery({
    queryKey: ['ratio-sync-auto-config'],
    queryFn: getRatioSyncAutoConfig,
  })
  const {
    data: remoteKeysData,
    isFetching: isFetchingRemoteKeys,
    error: remoteKeysError,
    refetch: refetchRemoteKeys,
  } = useQuery({
    queryKey: ['ratio-sync-remote-keys', config.account_id],
    queryFn: () => getRatioSyncAccountKeys(config.account_id),
    enabled: config.account_id !== '',
  })
  const {
    data: logsData,
    isFetching: isFetchingLogs,
    refetch: refetchLogs,
  } = useQuery({
    queryKey: ['ratio-sync-logs'],
    queryFn: () => getRatioSyncLogs(),
    refetchInterval: 5000,
  })

  useEffect(() => {
    if (!configData?.success) return
    setConfig({
      ...defaultConfig,
      ...configData.data,
      key_mappings: configData.data.key_mappings ?? [],
      interval_minutes:
        configData.data.interval_minutes > 0
          ? configData.data.interval_minutes
          : defaultConfig.interval_minutes,
    })
  }, [configData])

  const saveMutation = useMutation({
    mutationFn: updateRatioSyncAutoConfig,
    onSuccess: (data) => {
      if (!data.success) {
        toast.error(data.message || t('Failed to save automatic sync'))
        return
      }
      setConfig(data.data)
      queryClient.invalidateQueries({ queryKey: ['ratio-sync-auto-config'] })
      toast.success(t('Automatic sync saved'))
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to save automatic sync'))
    },
  })

  const runMutation = useMutation({
    mutationFn: async (currentConfig: RatioSyncAutoConfig) => {
      const saved = await updateRatioSyncAutoConfig(currentConfig)
      if (!saved.success) throw new Error(saved.message)
      const result = await runRatioSyncNow()
      if (!result.success) throw new Error(result.message)
      return { config: saved.data, task: result.data }
    },
    onSuccess: (result) => {
      setConfig(result.config)
      queryClient.invalidateQueries({ queryKey: ['ratio-sync-auto-config'] })
      queryClient.invalidateQueries({ queryKey: ['ratio-sync-logs'] })
      toast.success(t('Synchronization task started'))
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Synchronization failed'))
    },
  })

  const accounts = accountsData?.data ?? []
  const remoteKeys = remoteKeysData?.data ?? []
  const logs = logsData?.data ?? []
  const mappingsByKeyID = new Map(
    config.key_mappings.map((mapping) => [mapping.key_id, mapping])
  )
  const selectedKeyIDs = new Set(mappingsByKeyID.keys())
  const selectableKeys = remoteKeys.filter(
    (key) => key.status === 'active' && !key.expired && key.group_name !== ''
  )
  const allSelectableKeysSelected =
    selectableKeys.length > 0 &&
    selectableKeys.every((key) => selectedKeyIDs.has(key.id))
  const selectionInvalid =
    config.account_id === '' ||
    config.key_mappings.length === 0 ||
    config.key_mappings.some(
      (mapping) =>
        mapping.group_name.trim() === '' ||
        !props.localGroups.includes(mapping.group_name)
    )

  const toggleKey = (keyID: number, remoteGroup: string, checked: boolean) => {
    const defaultTargetGroup = props.localGroups.includes(remoteGroup)
      ? remoteGroup
      : (props.localGroups[0] ?? '')
    setConfig((previous) => ({
      ...previous,
      key_mappings: checked
        ? [
            ...previous.key_mappings.filter(
              (mapping) => mapping.key_id !== keyID
            ),
            { key_id: keyID, group_name: defaultTargetGroup },
          ]
        : previous.key_mappings.filter((mapping) => mapping.key_id !== keyID),
    }))
  }

  const updateTargetGroup = (keyID: number, groupName: string) => {
    setConfig((previous) => ({
      ...previous,
      key_mappings: previous.key_mappings.map((mapping) =>
        mapping.key_id === keyID
          ? { ...mapping, group_name: groupName }
          : mapping
      ),
    }))
  }

  let keyListContent: ReactNode
  if (isFetchingRemoteKeys) {
    keyListContent = (
      <div className='text-muted-foreground flex items-center gap-2 p-4 text-sm'>
        <Spinner />
        {t('Fetching keys...')}
      </div>
    )
  } else if (remoteKeysError) {
    keyListContent = (
      <p className='text-destructive p-4 text-sm'>
        {t('Failed to fetch sub2api keys')}
      </p>
    )
  } else if (config.account_id === '') {
    keyListContent = (
      <p className='text-muted-foreground p-4 text-sm'>
        {t('Select a saved account to load its keys.')}
      </p>
    )
  } else if (remoteKeys.length === 0) {
    keyListContent = (
      <p className='text-muted-foreground p-4 text-sm'>
        {t('No sub2api keys found')}
      </p>
    )
  } else {
    keyListContent = remoteKeys.map((key) => {
      const disabled =
        key.status !== 'active' || key.expired || key.group_name === ''
      return (
        <Field
          key={key.id}
          orientation='horizontal'
          data-disabled={disabled}
          className='grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-3 md:grid-cols-[auto_minmax(0,1fr)_minmax(10rem,14rem)]'
        >
          <Checkbox
            id={`ratio-sync-key-${key.id}`}
            checked={selectedKeyIDs.has(key.id)}
            onCheckedChange={(checked) =>
              toggleKey(key.id, key.group_name, checked)
            }
            disabled={disabled}
            aria-label={t('Select key {{name}}', { name: key.name })}
          />
          <FieldLabel
            htmlFor={`ratio-sync-key-${key.id}`}
            className='min-w-0 flex-1 cursor-pointer items-start'
          >
            <span className='min-w-0 flex-1'>
              <span className='flex flex-wrap items-center gap-2'>
                <span className='font-medium break-all'>
                  {key.name || t('Unnamed key')}
                </span>
                <Badge variant={disabled ? 'destructive' : 'secondary'}>
                  {key.expired ? t('Expired') : key.status}
                </Badge>
              </span>
              <span className='text-muted-foreground mt-1 block font-mono text-xs break-all'>
                {key.masked_key}
              </span>
              <span className='text-muted-foreground mt-1 flex flex-wrap gap-x-3 text-xs'>
                <span>
                  {t('Group')}: {key.group_name || t('Not assigned')}
                </span>
                {key.group_platform && <span>{key.group_platform}</span>}
                {key.group_name && (
                  <span>
                    {t('Ratio')}: {key.group_ratio}
                  </span>
                )}
              </span>
            </span>
          </FieldLabel>
          <Field className='col-start-2 gap-1 md:col-start-3 md:row-start-1'>
            <FieldLabel
              htmlFor={`ratio-sync-target-group-${key.id}`}
              className='text-muted-foreground text-xs'
            >
              {t('Target group')}
            </FieldLabel>
            <Select
              items={props.localGroups.map((group) => ({
                value: group,
                label: group,
              }))}
              value={mappingsByKeyID.get(key.id)?.group_name ?? ''}
              onValueChange={(groupName) =>
                updateTargetGroup(key.id, groupName ?? '')
              }
              disabled={
                !selectedKeyIDs.has(key.id) ||
                disabled ||
                props.localGroups.length === 0
              }
            >
              <SelectTrigger id={`ratio-sync-target-group-${key.id}`}>
                <SelectValue placeholder={t('Group')} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {props.localGroups.map((group) => (
                    <SelectItem key={group} value={group}>
                      {group}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </Field>
      )
    })
  }

  return (
    <section className='border-border bg-muted/20 flex flex-col gap-5 border p-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h3 className='text-sm font-medium'>{t('Automatic price sync')}</h3>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Map selected sub2api keys to local groups and sync only pricing and ratios.'
            )}
          </p>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) =>
            setConfig((previous) => ({ ...previous, enabled }))
          }
          aria-label={t('Enable automatic sync')}
        />
      </div>

      <FieldGroup className='grid gap-4 md:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='ratio-sync-auto-account'>
            {t('Saved account')}
          </FieldLabel>
          <Select
            items={accounts.map((account) => ({
              value: account.id,
              label: account.name,
            }))}
            value={config.account_id}
            onValueChange={(accountID) =>
              setConfig((previous) => ({
                ...previous,
                account_id: accountID ?? '',
                key_mappings: [],
              }))
            }
          >
            <SelectTrigger id='ratio-sync-auto-account'>
              <SelectValue placeholder={t('Select account')} />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor='ratio-sync-auto-interval'>
            {t('Sync interval (minutes)')}
          </FieldLabel>
          <Input
            id='ratio-sync-auto-interval'
            type='number'
            min={1}
            max={1440}
            value={config.interval_minutes}
            onChange={(event) =>
              setConfig((previous) => ({
                ...previous,
                interval_minutes: Number(event.target.value),
              }))
            }
          />
        </Field>
      </FieldGroup>

      <FieldSet>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <FieldLegend variant='label'>{t('Keys to sync')}</FieldLegend>
            <FieldDescription>
              {t('{{count}} keys selected', {
                count: config.key_mappings.length,
              })}
            </FieldDescription>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() =>
                setConfig((previous) => ({
                  ...previous,
                  key_mappings: allSelectableKeysSelected
                    ? []
                    : selectableKeys.map((key) => ({
                        key_id: key.id,
                        group_name: props.localGroups.includes(key.group_name)
                          ? key.group_name
                          : (props.localGroups[0] ?? ''),
                      })),
                }))
              }
              disabled={
                selectableKeys.length === 0 || props.localGroups.length === 0
              }
            >
              {allSelectableKeysSelected
                ? t('Clear selection')
                : t('Select all')}
            </Button>
            <Button
              type='button'
              variant='outline'
              size='icon-sm'
              onClick={() => refetchRemoteKeys()}
              disabled={config.account_id === '' || isFetchingRemoteKeys}
              aria-label={t('Refresh key list')}
            >
              {isFetchingRemoteKeys ? <Spinner /> : <RefreshCw />}
            </Button>
          </div>
        </div>

        <div className='border-border divide-border max-h-80 divide-y overflow-y-auto border'>
          {keyListContent}
        </div>
      </FieldSet>

      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          onClick={() => saveMutation.mutate(config)}
          disabled={
            saveMutation.isPending || (config.enabled && selectionInvalid)
          }
        >
          {saveMutation.isPending ? (
            <Spinner data-icon='inline-start' />
          ) : (
            <Save />
          )}
          {t('Save automatic sync')}
        </Button>
        <Button
          type='button'
          variant='outline'
          onClick={() => runMutation.mutate(config)}
          disabled={runMutation.isPending || selectionInvalid}
        >
          {runMutation.isPending ? (
            <Spinner data-icon='inline-start' />
          ) : (
            <RefreshCw />
          )}
          {t('Sync now')}
        </Button>
      </div>

      <Separator />

      <section className='flex flex-col gap-3'>
        <div className='flex items-center justify-between gap-3'>
          <h3 className='text-sm font-medium'>{t('Sync history')}</h3>
          <Button
            type='button'
            variant='outline'
            size='icon-sm'
            onClick={() => refetchLogs()}
            disabled={isFetchingLogs}
            aria-label={t('Refresh sync history')}
          >
            {isFetchingLogs ? <Spinner /> : <RefreshCw />}
          </Button>
        </div>

        <div className='border-border divide-border max-h-72 divide-y overflow-y-auto border'>
          {logs.length === 0 ? (
            <p className='text-muted-foreground p-4 text-sm'>
              {t('No synchronization records')}
            </p>
          ) : (
            logs.map((log) => {
              let statusLabel = t('Pending')
              let statusVariant: 'outline' | 'secondary' | 'destructive' =
                'outline'
              if (log.status === 'running') {
                statusLabel = t('Running')
                statusVariant = 'secondary'
              } else if (log.status === 'succeeded') {
                statusLabel = t('Succeeded')
                statusVariant = 'secondary'
              } else if (log.status === 'failed') {
                statusLabel = t('Failed')
                statusVariant = 'destructive'
              }
              const trigger =
                log.result?.trigger ?? log.payload?.trigger ?? 'automatic'
              return (
                <div
                  key={log.task_id}
                  className='flex flex-col gap-2 p-3 text-sm'
                >
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <Badge variant={statusVariant}>{statusLabel}</Badge>
                      <span className='font-medium'>
                        {log.result?.account_name || t('Saved account')}
                      </span>
                      <span className='text-muted-foreground text-xs'>
                        {trigger === 'manual' ? t('Manual') : t('Automatic')}
                      </span>
                    </div>
                    <time className='text-muted-foreground text-xs'>
                      {new Date(log.created_at * 1000).toLocaleString()}
                    </time>
                  </div>
                  {log.result && (
                    <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
                      <span>
                        {t('Mappings')}: {log.result.mapping_count}
                      </span>
                      <span>
                        {t('Models updated')}: {log.result.updated_models}
                      </span>
                      <span>
                        {t('Groups updated')}: {log.result.updated_groups}
                      </span>
                      <span>
                        {t('Duration')}: {log.result.duration_ms} ms
                      </span>
                    </div>
                  )}
                  {log.error && (
                    <p className='text-destructive text-xs break-all'>
                      {log.error}
                    </p>
                  )}
                </div>
              )
            })
          )}
        </div>
      </section>
    </section>
  )
}
