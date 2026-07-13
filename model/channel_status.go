package model

import (
	"time"
)

// PublicChannelStatus contains only channel fields that are safe to expose to
// authenticated users. Credentials, endpoints, balances, and routing details
// intentionally stay out of this projection.
type PublicChannelStatus struct {
	ID           int    `json:"id"`
	Name         string `json:"name"`
	Type         int    `json:"type"`
	Status       int    `json:"status"`
	ResponseTime int    `json:"response_time"`
	TestTime     int64  `json:"test_time"`
	Models       string `json:"models"`
}

type ChannelStatusHistory struct {
	ID           int   `json:"id"`
	ChannelID    int   `json:"channel_id" gorm:"index:idx_channel_status_history_channel_time,priority:1"`
	Status       int   `json:"status"`
	ResponseTime int   `json:"response_time"`
	CheckedAt    int64 `json:"checked_at" gorm:"index:idx_channel_status_history_channel_time,priority:2"`
}

func GetPublicChannelStatuses() ([]PublicChannelStatus, error) {
	statuses := make([]PublicChannelStatus, 0)
	err := DB.Model(&Channel{}).
		Select("id, name, type, status, response_time, test_time, models").
		Order("priority DESC, id DESC").
		Find(&statuses).Error
	return statuses, err
}

func RecordChannelStatusHistory(channelID int, status int, responseTime int64, checkedAt int64) error {
	if checkedAt <= 0 {
		checkedAt = time.Now().Unix()
	}
	return DB.Create(&ChannelStatusHistory{
		ChannelID:    channelID,
		Status:       status,
		ResponseTime: int(responseTime),
		CheckedAt:    checkedAt,
	}).Error
}

func GetChannelStatusHistory(channelIDs []int, startTime int64) ([]ChannelStatusHistory, error) {
	if len(channelIDs) == 0 {
		return []ChannelStatusHistory{}, nil
	}

	history := make([]ChannelStatusHistory, 0)
	err := DB.Where("channel_id IN ? AND checked_at >= ?", channelIDs, startTime).
		Order("checked_at DESC").
		Find(&history).Error
	return history, err
}
