package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type tokenHeatmapResponse struct {
	Success bool                    `json:"success"`
	Message string                  `json:"message"`
	Data    []model.DailyTokenUsage `json:"data"`
}

func TestGetUserTokenUsageHeatmapRestrictsDataToAuthenticatedUser(t *testing.T) {
	setupFlowControllerTestDB(t)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", 1)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/data/self/token-heatmap?start_timestamp=1000&end_timestamp=2000&timezone=UTC", nil)

	GetUserTokenUsageHeatmap(ctx)

	require.Equal(t, http.StatusOK, recorder.Code)
	var payload tokenHeatmapResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.True(t, payload.Success, payload.Message)
	require.Equal(t, []model.DailyTokenUsage{{Date: "1970-01-01", TokenUsed: 40}}, payload.Data)
}

func TestGetUserTokenUsageHeatmapRejectsInvalidTimezone(t *testing.T) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", 1)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/data/self/token-heatmap?start_timestamp=1000&end_timestamp=2000&timezone=not-a-timezone", nil)

	GetUserTokenUsageHeatmap(ctx)

	require.Equal(t, http.StatusOK, recorder.Code)
	var payload tokenHeatmapResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.False(t, payload.Success)
	require.Equal(t, "invalid timezone", payload.Message)
}

func TestGetUserTokenUsageHeatmapRejectsOversizedRange(t *testing.T) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", 1)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/data/self/token-heatmap?start_timestamp=1000&end_timestamp=40000000&timezone=UTC", nil)

	GetUserTokenUsageHeatmap(ctx)

	require.Equal(t, http.StatusOK, recorder.Code)
	var payload tokenHeatmapResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.False(t, payload.Success)
	require.Equal(t, "time range cannot exceed 366 days", payload.Message)
}
