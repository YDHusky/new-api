package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestGetDailyTokenUsageByUserIdAggregatesInRequestedTimezone(t *testing.T) {
	truncateTables(t)

	firstHour := time.Date(2026, time.January, 2, 23, 0, 0, 0, time.UTC).Unix()
	secondHour := time.Date(2026, time.January, 3, 1, 0, 0, 0, time.UTC).Unix()
	rows := []QuotaData{
		{UserID: 1, ModelName: "gpt-a", CreatedAt: firstHour, TokenUsed: 10},
		{UserID: 1, ModelName: "gpt-b", CreatedAt: firstHour, TokenUsed: 20},
		{UserID: 1, ModelName: "gpt-a", CreatedAt: secondHour, TokenUsed: 30},
		{UserID: 2, ModelName: "gpt-a", CreatedAt: secondHour, TokenUsed: 999},
	}
	require.NoError(t, DB.Create(&rows).Error)

	location, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)
	usage, err := GetDailyTokenUsageByUserId(1, firstHour, secondHour, location)
	require.NoError(t, err)
	require.Equal(t, []DailyTokenUsage{{
		Date:      "2026-01-03",
		TokenUsed: 60,
	}}, usage)
}
