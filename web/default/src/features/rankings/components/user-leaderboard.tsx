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
import { UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatQuotaWithCurrency } from '@/lib/currency'

import { formatTokens } from '../lib/format'
import type { UserRanking } from '../types'
import { GrowthText } from './growth-text'

type UserLeaderboardProps = {
  rows: UserRanking[]
}

export function UserLeaderboard({ rows }: UserLeaderboardProps) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return (
      <div className='text-muted-foreground/80 px-5 py-8 text-center text-sm'>
        {t('No user consumption data available')}
      </div>
    )
  }

  return (
    <section className='bg-card overflow-hidden rounded-lg border'>
      <header className='flex items-start justify-between gap-4 border-b px-5 py-4'>
        <div className='min-w-0'>
          <h2 className='text-foreground inline-flex items-center gap-2 text-base font-semibold'>
            <UsersRound className='text-primary size-4' />
            {t('User Consumption Ranking')}
          </h2>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t('Consumption by user during the selected period')}
          </p>
        </div>
      </header>
      <div className='grid grid-cols-1 gap-x-8 px-5 py-2 md:grid-cols-2'>
        {splitRows(rows).map((column, columnIndex) => (
          <ul key={columnIndex === 0 ? 'primary' : 'secondary'}>
            {column.map((row) => (
              <li key={`${row.username}-${row.rank}`} className='flex items-center gap-3 py-2.5'>
                <span className='text-muted-foreground/80 w-6 shrink-0 text-right font-mono text-xs tabular-nums'>
                  {row.rank}.
                </span>
                <div className='min-w-0 flex-1'>
                  <p className='text-foreground truncate text-sm font-medium'>
                    {row.username || t('Unknown user')}
                  </p>
                  <p className='text-muted-foreground/80 truncate text-xs'>
                    {formatTokens(row.total_tokens)} {t('tokens')}
                  </p>
                </div>
                <div className='shrink-0 text-right'>
                  <div className='text-foreground font-mono text-sm font-semibold tabular-nums'>
                    {formatQuotaWithCurrency(row.total_quota)}
                  </div>
                  <GrowthText value={row.growth_pct} className='text-[11px]' />
                </div>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  )
}

function splitRows(rows: UserRanking[]): UserRanking[][] {
  const half = Math.ceil(rows.length / 2)
  return [rows.slice(0, half), rows.slice(half)]
}
