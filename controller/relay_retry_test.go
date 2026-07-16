package controller

import (
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestShouldRetryUsesNextOrderedGroupWhenRetryBudgetIsZero(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyTokenGroups, []string{"primary", "backup"})
	common.SetContextKey(ctx, constant.ContextKeyAutoGroup, "primary")

	upstreamError := types.NewOpenAIError(errors.New("upstream failed"), types.ErrorCodeBadResponseStatusCode, 500)
	assert.True(t, shouldRetry(ctx, upstreamError, 0))
	assert.True(t, shouldRetryTaskRelay(ctx, 1, &dto.TaskError{StatusCode: 500}, 0))

	common.SetContextKey(ctx, constant.ContextKeyAutoGroup, "backup")
	assert.False(t, shouldRetry(ctx, upstreamError, 0))
	assert.False(t, shouldRetryTaskRelay(ctx, 1, &dto.TaskError{StatusCode: 500}, 0))
}
