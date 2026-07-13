package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetRankings(c *gin.Context) {
	period := c.DefaultQuery("period", "week")
	result, err := service.GetRankingsSnapshot(period)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	response := *result
	if model.IsAdmin(c.GetInt("id")) || (c.GetInt("id") > 0 && middleware.UserRankingEnabled()) {
		response.Users, err = service.GetUserConsumptionRankings(period)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    &response,
	})
}
