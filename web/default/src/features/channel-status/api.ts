import { api } from '@/lib/api'

import type { ChannelStatusResponse } from './types'

export async function getChannelStatuses(): Promise<ChannelStatusResponse> {
  const response = await api.get<ChannelStatusResponse>('/api/channel-status')
  return response.data
}
