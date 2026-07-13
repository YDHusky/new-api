package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetChannelStatuses(c *gin.Context) {
	statuses, err := service.GetChannelStatuses()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, statuses)
}
