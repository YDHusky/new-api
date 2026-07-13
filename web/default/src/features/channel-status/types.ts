export type ChannelStatus = {
  id: number
  name: string
  type: number
  status: number
  response_time: number
  test_time: number
  models: string[]
  checks: ChannelStatusCheck[]
}

export type ChannelStatusCheck = {
  status: number
  response_time: number
  checked_at: number
}

export type ChannelStatusResponse = {
  success: boolean
  data: ChannelStatus[]
  message?: string
}
