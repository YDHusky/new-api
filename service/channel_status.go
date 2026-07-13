package service

import (
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/model"
)

type ChannelStatus struct {
	ID           int                  `json:"id"`
	Name         string               `json:"name"`
	Type         int                  `json:"type"`
	Status       int                  `json:"status"`
	ResponseTime int                  `json:"response_time"`
	TestTime     int64                `json:"test_time"`
	Models       []string             `json:"models"`
	Checks       []ChannelStatusCheck `json:"checks"`
}

type ChannelStatusCheck struct {
	Status       int   `json:"status"`
	ResponseTime int   `json:"response_time"`
	CheckedAt    int64 `json:"checked_at"`
}

func GetChannelStatuses() ([]ChannelStatus, error) {
	rows, err := model.GetPublicChannelStatuses()
	if err != nil {
		return nil, err
	}
	channelIDs := make([]int, 0, len(rows))
	for _, row := range rows {
		channelIDs = append(channelIDs, row.ID)
	}
	history, err := model.GetChannelStatusHistory(channelIDs, time.Now().Add(-30*24*time.Hour).Unix())
	if err != nil {
		return nil, err
	}
	historyByChannel := make(map[int][]ChannelStatusCheck, len(channelIDs))
	for _, item := range history {
		checks := historyByChannel[item.ChannelID]
		if len(checks) >= 60 {
			continue
		}
		historyByChannel[item.ChannelID] = append(checks, ChannelStatusCheck{
			Status:       item.Status,
			ResponseTime: item.ResponseTime,
			CheckedAt:    item.CheckedAt,
		})
	}

	statuses := make([]ChannelStatus, 0, len(rows))
	for _, row := range rows {
		checks := historyByChannel[row.ID]
		for left, right := 0, len(checks)-1; left < right; left, right = left+1, right-1 {
			checks[left], checks[right] = checks[right], checks[left]
		}
		if len(checks) == 0 && row.TestTime > 0 {
			checks = []ChannelStatusCheck{{
				Status:       row.Status,
				ResponseTime: row.ResponseTime,
				CheckedAt:    row.TestTime,
			}}
		}
		if checks == nil {
			checks = []ChannelStatusCheck{}
		}
		statuses = append(statuses, ChannelStatus{
			ID:           row.ID,
			Name:         row.Name,
			Type:         row.Type,
			Status:       row.Status,
			ResponseTime: row.ResponseTime,
			TestTime:     row.TestTime,
			Models:       parseChannelStatusModels(row.Models),
			Checks:       checks,
		})
	}

	sort.SliceStable(statuses, func(i, j int) bool {
		if statuses[i].Status != statuses[j].Status {
			return statuses[i].Status < statuses[j].Status
		}
		return statuses[i].Name < statuses[j].Name
	})
	return statuses, nil
}

func parseChannelStatusModels(raw string) []string {
	parts := strings.Split(raw, ",")
	models := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		modelName := strings.TrimSpace(part)
		if modelName == "" {
			continue
		}
		if _, ok := seen[modelName]; ok {
			continue
		}
		seen[modelName] = struct{}{}
		models = append(models, modelName)
	}
	return models
}
