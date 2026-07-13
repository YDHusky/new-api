package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildRankedUsersRanksByConsumptionAndTracksGrowth(t *testing.T) {
	previous := []model.RankingUserTotal{
		{UserID: 1, Username: "alice", TotalQuota: 100},
		{UserID: 2, Username: "bob", TotalQuota: 50},
	}
	current := []model.RankingUserTotal{
		{UserID: 2, Username: "bob", TotalQuota: 200, TotalTokens: 3000},
		{UserID: 1, Username: "alice", TotalQuota: 100, TotalTokens: 1000},
	}

	rows := buildRankedUsers(current, previous)

	require.Len(t, rows, 2)
	assert.Equal(t, 1, rows[0].Rank)
	assert.Equal(t, "bob", rows[0].Username)
	assert.Equal(t, int64(200), rows[0].TotalQuota)
	assert.Equal(t, 0.6667, rows[0].Share)
	assert.Equal(t, 300.0, rows[0].GrowthPct)
	assert.Equal(t, 2, rows[1].Rank)
	assert.Equal(t, 1, *rows[1].PreviousRank)
}
