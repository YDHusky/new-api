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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import {
  createRatioSyncAccount,
  deleteRatioSyncAccount,
  getRatioSyncAccounts,
  updateRatioSyncAccount,
} from '../api'

export type Sub2apiImportConfig = {
  baseURL: string
  authMode: 'api-key' | 'account-login'
  savedAccountId: string
  apiKey: string
  loginEmail: string
  loginPassword: string
  totpCode: string
  ratioFormula: string
  proxyURL: string
}

type Sub2apiImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (config: Sub2apiImportConfig) => void
  isLoading: boolean
}

export function Sub2apiImportDialog(props: Sub2apiImportDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const schema = z
    .object({
      baseURL: z.string().trim().url(t('Please enter a valid URL')),
      authMode: z.enum(['api-key', 'account-login']),
      accountName: z.string().trim(),
      savedAccountId: z.string(),
      apiKey: z.string().trim(),
      loginEmail: z.string().trim(),
      loginPassword: z.string(),
      totpCode: z.string().trim(),
      ratioFormula: z
        .string()
        .trim()
        .max(256, t('Formula must be 256 characters or fewer')),
      proxyURL: z
        .string()
        .trim()
        .refine((value) => {
          if (value === '') return true
          try {
            const parsed = new URL(value)
            return parsed.protocol === 'http:' || parsed.protocol === 'https:'
          } catch {
            return false
          }
        }, t('Please enter a valid proxy URL')),
    })
    .superRefine((values, context) => {
      if (
        values.savedAccountId === '' &&
        values.authMode === 'api-key' &&
        values.apiKey === ''
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('API key is required'),
          path: ['apiKey'],
        })
      }
      if (
        values.savedAccountId === '' &&
        values.authMode === 'account-login' &&
        values.loginEmail === ''
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('Email is required'),
          path: ['loginEmail'],
        })
      }
      if (
        values.savedAccountId === '' &&
        values.authMode === 'account-login' &&
        values.loginPassword === ''
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('Password is required'),
          path: ['loginPassword'],
        })
      }
    })
  type FormValues = z.infer<typeof schema>

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      baseURL: '',
      authMode: 'account-login',
      accountName: '',
      savedAccountId: '',
      apiKey: '',
      loginEmail: '',
      loginPassword: '',
      totpCode: '',
      ratioFormula: '',
      proxyURL: '',
    },
  })
  const authMode = form.watch('authMode')
  const savedAccountId = form.watch('savedAccountId')
  const { data: accountsData } = useQuery({
    queryKey: ['ratio-sync-accounts'],
    queryFn: getRatioSyncAccounts,
    enabled: props.open,
  })
  const accounts = accountsData?.data ?? []

  const saveAccountMutation = useMutation({
    mutationFn: (variables: {
      accountID: string
      request: Parameters<typeof createRatioSyncAccount>[0]
    }) =>
      variables.accountID === ''
        ? createRatioSyncAccount(variables.request)
        : updateRatioSyncAccount(variables.accountID, variables.request),
    onSuccess: (data, variables) => {
      if (!data.success) {
        toast.error(data.message || t('Failed to save sync account'))
        return
      }
      form.setValue('savedAccountId', data.data.id)
      queryClient.invalidateQueries({ queryKey: ['ratio-sync-accounts'] })
      toast.success(
        variables.accountID === ''
          ? t('Sync account saved')
          : t('Sync account updated')
      )
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to save sync account'))
    },
  })

  const deleteAccountMutation = useMutation({
    mutationFn: deleteRatioSyncAccount,
    onSuccess: (data) => {
      if (!data.success) {
        toast.error(data.message || t('Failed to delete sync account'))
        return
      }
      form.setValue('savedAccountId', '')
      queryClient.invalidateQueries({ queryKey: ['ratio-sync-accounts'] })
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to delete sync account'))
    },
  })

  useEffect(() => {
    if (!props.open) {
      form.reset()
    }
  }, [form, props.open])

  const onSubmit = (values: FormValues) => {
    props.onImport({
      baseURL: values.baseURL.replace(/\/+$/, ''),
      authMode: values.authMode,
      savedAccountId: values.savedAccountId,
      apiKey: values.apiKey,
      loginEmail: values.loginEmail,
      loginPassword: values.loginPassword,
      totpCode: values.totpCode,
      ratioFormula: values.ratioFormula,
      proxyURL: values.proxyURL,
    })
  }

  const handleSelectSavedAccount = (accountID: string | null) => {
    if (!accountID || accountID === '__new__') {
      form.reset()
      return
    }
    const account = accounts.find((item) => item.id === accountID)
    if (!account) return
    form.setValue('savedAccountId', account.id)
    form.setValue('accountName', account.name)
    form.setValue('baseURL', account.base_url)
    form.setValue('authMode', account.auth_mode)
    form.setValue('loginEmail', account.login_email ?? '')
    form.setValue('proxyURL', account.proxy_url ?? '')
    form.setValue('ratioFormula', account.ratio_formula ?? '')
    form.setValue('apiKey', '')
    form.setValue('loginPassword', '')
  }

  const handleSaveAccount = async () => {
    const values = form.getValues()
    if (values.accountName === '') {
      form.setError('accountName', { message: t('Account name is required') })
      return
    }
    const fields: Array<keyof FormValues> = [
      'baseURL',
      'authMode',
      'ratioFormula',
      'proxyURL',
    ]
    if (values.authMode === 'api-key') {
      fields.push('apiKey')
    } else {
      fields.push('loginEmail', 'loginPassword')
    }
    if (!(await form.trigger(fields))) return
    saveAccountMutation.mutate({
      accountID: values.savedAccountId,
      request: {
        name: values.accountName,
        base_url: values.baseURL,
        auth_mode: values.authMode,
        api_key: values.authMode === 'api-key' ? values.apiKey : undefined,
        login_email:
          values.authMode === 'account-login' ? values.loginEmail : undefined,
        login_password:
          values.authMode === 'account-login'
            ? values.loginPassword
            : undefined,
        proxy_url: values.proxyURL,
        ratio_formula: values.ratioFormula,
      },
    })
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Import from sub2api')}
      description={t(
        'Fetch model pricing and group rates from a sub2api site for preview.'
      )}
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={props.isLoading}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={handleSaveAccount}
            disabled={props.isLoading || saveAccountMutation.isPending}
          >
            {savedAccountId === '' ? t('Save account') : t('Update account')}
          </Button>
          <Button
            type='submit'
            form='sub2api-import-form'
            disabled={props.isLoading}
          >
            {props.isLoading ? t('Fetching...') : t('Fetch and preview')}
          </Button>
        </>
      }
    >
      <form
        id='sub2api-import-form'
        className='flex flex-col gap-4'
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <div className='flex flex-col gap-2'>
          <Label htmlFor='sub2api-base-url'>{t('sub2api URL')}</Label>
          <Input
            id='sub2api-base-url'
            placeholder='https://sub2api.example.com'
            autoComplete='url'
            {...form.register('baseURL')}
          />
          {form.formState.errors.baseURL && (
            <p className='text-destructive text-xs'>
              {form.formState.errors.baseURL.message}
            </p>
          )}
        </div>

        <div className='flex flex-col gap-2'>
          <Label htmlFor='sub2api-saved-account'>{t('Saved accounts')}</Label>
          <div className='flex items-center gap-2'>
            <Select
              items={[
                { value: '__new__', label: t('New account') },
                ...accounts.map((account) => ({
                  value: account.id,
                  label: account.name,
                })),
              ]}
              value={savedAccountId || '__new__'}
              onValueChange={handleSelectSavedAccount}
            >
              <SelectTrigger
                id='sub2api-saved-account'
                className='min-w-0 flex-1'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value='__new__'>{t('New account')}</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {savedAccountId !== '' && (
              <Button
                type='button'
                variant='outline'
                size='icon'
                onClick={() => deleteAccountMutation.mutate(savedAccountId)}
                disabled={deleteAccountMutation.isPending}
                aria-label={t('Delete saved account')}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        </div>

        <div className='flex flex-col gap-2'>
          <Label htmlFor='sub2api-account-name'>{t('Account name')}</Label>
          <Input id='sub2api-account-name' {...form.register('accountName')} />
          {form.formState.errors.accountName && (
            <p className='text-destructive text-xs'>
              {form.formState.errors.accountName.message}
            </p>
          )}
        </div>

        <div className='flex flex-col gap-2'>
          <Label>{t('Authentication method')}</Label>
          <ToggleGroup
            value={[authMode]}
            onValueChange={(value) => {
              const nextValue = value[0]
              if (nextValue === 'api-key' || nextValue === 'account-login') {
                form.setValue('authMode', nextValue, { shouldValidate: true })
              }
            }}
            variant='outline'
            spacing={0}
          >
            <ToggleGroupItem value='account-login'>
              {t('Account login')}
            </ToggleGroupItem>
            <ToggleGroupItem value='api-key'>{t('API key')}</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {authMode === 'account-login' ? (
          <>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='sub2api-login-email'>{t('Account email')}</Label>
              <Input
                id='sub2api-login-email'
                type='email'
                autoComplete='username'
                {...form.register('loginEmail')}
              />
              {form.formState.errors.loginEmail && (
                <p className='text-destructive text-xs'>
                  {form.formState.errors.loginEmail.message}
                </p>
              )}
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='sub2api-login-password'>
                {t('Account password')}
              </Label>
              <Input
                id='sub2api-login-password'
                type='password'
                autoComplete='current-password'
                placeholder={
                  savedAccountId
                    ? t('Leave blank to keep the saved credential')
                    : undefined
                }
                {...form.register('loginPassword')}
              />
              {form.formState.errors.loginPassword && (
                <p className='text-destructive text-xs'>
                  {form.formState.errors.loginPassword.message}
                </p>
              )}
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='sub2api-totp-code'>
                {t('Two-factor code (optional)')}
              </Label>
              <Input
                id='sub2api-totp-code'
                inputMode='numeric'
                autoComplete='one-time-code'
                {...form.register('totpCode')}
              />
            </div>
          </>
        ) : (
          <div className='flex flex-col gap-2'>
            <Label htmlFor='sub2api-api-key'>{t('API key')}</Label>
            <Input
              id='sub2api-api-key'
              type='password'
              autoComplete='off'
              placeholder={
                savedAccountId
                  ? t('Leave blank to keep the saved credential')
                  : undefined
              }
              {...form.register('apiKey')}
            />
            {form.formState.errors.apiKey && (
              <p className='text-destructive text-xs'>
                {form.formState.errors.apiKey.message}
              </p>
            )}
          </div>
        )}

        <div className='flex flex-col gap-2'>
          <Label htmlFor='sub2api-ratio-formula'>{t('Ratio formula')}</Label>
          <Input
            id='sub2api-ratio-formula'
            placeholder='value + 0.1'
            {...form.register('ratioFormula')}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              'Leave empty to keep imported ratios unchanged. Use value, for example value + 0.1. Applied to model and group ratios.'
            )}
          </p>
          {form.formState.errors.ratioFormula && (
            <p className='text-destructive text-xs'>
              {form.formState.errors.ratioFormula.message}
            </p>
          )}
        </div>

        <div className='flex flex-col gap-2'>
          <Label htmlFor='sub2api-proxy-url'>{t('Proxy URL (optional)')}</Label>
          <Input
            id='sub2api-proxy-url'
            placeholder='http://localhost:7897'
            autoComplete='off'
            {...form.register('proxyURL')}
          />
          {form.formState.errors.proxyURL && (
            <p className='text-destructive text-xs'>
              {form.formState.errors.proxyURL.message}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  )
}
