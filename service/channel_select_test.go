package service

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestOrderedTokenGroupsFallbackAndRecoverToFirstGroup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = originalMemoryCacheEnabled })

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))
	t.Cleanup(func() {
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	backupPriority := int64(0)
	backup := model.Channel{
		Name:   "backup",
		Type:   1,
		Key:    "backup-key",
		Status: common.ChannelStatusEnabled,
		Models: "test-model",
		Group:  "backup",
	}
	require.NoError(t, db.Create(&backup).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group: "backup", Model: "test-model", ChannelId: backup.Id,
		Enabled: true, Priority: &backupPriority, Weight: 100,
	}).Error)
	model.InitChannelCache()

	newContext := func() *gin.Context {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		common.SetContextKey(ctx, constant.ContextKeyTokenGroups, []string{"primary", "backup"})
		return ctx
	}

	channel, selectedGroup, err := CacheGetRandomSatisfiedChannel(&RetryParam{
		Ctx: newContext(), TokenGroup: "primary", ModelName: "test-model", Retry: common.GetPointer(0),
	})
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, backup.Id, channel.Id)
	assert.Equal(t, "backup", selectedGroup)

	primaryPriority := int64(0)
	primary := model.Channel{
		Name:   "primary",
		Type:   1,
		Key:    "primary-key",
		Status: common.ChannelStatusEnabled,
		Models: "test-model",
		Group:  "primary",
	}
	require.NoError(t, db.Create(&primary).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group: "primary", Model: "test-model", ChannelId: primary.Id,
		Enabled: true, Priority: &primaryPriority, Weight: 100,
	}).Error)
	model.InitChannelCache()

	channel, selectedGroup, err = CacheGetRandomSatisfiedChannel(&RetryParam{
		Ctx: newContext(), TokenGroup: "primary", ModelName: "test-model", Retry: common.GetPointer(0),
	})
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, primary.Id, channel.Id)
	assert.Equal(t, "primary", selectedGroup)
}

func TestOrderedTokenGroupsAdvanceAfterUpstreamFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = originalMemoryCacheEnabled })

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))
	t.Cleanup(func() {
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	priority := int64(0)
	primary := model.Channel{Name: "primary", Type: 1, Key: "primary-key", Status: common.ChannelStatusEnabled, Models: "test-model", Group: "primary"}
	backup := model.Channel{Name: "backup", Type: 1, Key: "backup-key", Status: common.ChannelStatusEnabled, Models: "test-model", Group: "backup"}
	require.NoError(t, db.Create(&primary).Error)
	require.NoError(t, db.Create(&backup).Error)
	require.NoError(t, db.Create(&model.Ability{Group: "primary", Model: "test-model", ChannelId: primary.Id, Enabled: true, Priority: &priority, Weight: 100}).Error)
	require.NoError(t, db.Create(&model.Ability{Group: "backup", Model: "test-model", ChannelId: backup.Id, Enabled: true, Priority: &priority, Weight: 100}).Error)
	model.InitChannelCache()

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyTokenGroups, []string{"primary", "backup"})
	retryParam := &RetryParam{Ctx: ctx, TokenGroup: "primary", ModelName: "test-model", Retry: common.GetPointer(0)}

	channel, selectedGroup, err := CacheGetRandomSatisfiedChannel(retryParam)
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, primary.Id, channel.Id)
	assert.Equal(t, "primary", selectedGroup)

	assert.True(t, retryParam.AdvanceToNextOrderedGroup())
	retryParam.IncreaseRetry()
	channel, selectedGroup, err = CacheGetRandomSatisfiedChannel(retryParam)
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, backup.Id, channel.Id)
	assert.Equal(t, "backup", selectedGroup)
}
