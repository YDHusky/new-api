package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

const ratioSyncAutoConfigOptionKey = "RatioSyncAutoConfigSecret"

var errSub2APIAuthenticationInvalid = errors.New("sub2api authentication is invalid")

type ratioSyncAutoConfig struct {
	Enabled         bool                  `json:"enabled"`
	AccountID       string                `json:"account_id"`
	IntervalMinutes int                   `json:"interval_minutes"`
	KeyMappings     []ratioSyncKeyMapping `json:"key_mappings"`
}

type ratioSyncKeyMapping struct {
	KeyID     int64  `json:"key_id"`
	GroupName string `json:"group_name"`
}

type ratioSyncTaskPayload struct {
	Trigger string `json:"trigger"`
}

type ratioSyncRunSummary struct {
	Trigger       string `json:"trigger"`
	AccountID     string `json:"account_id"`
	AccountName   string `json:"account_name"`
	MappingCount  int    `json:"mapping_count"`
	UpdatedModels int    `json:"updated_models"`
	UpdatedGroups int    `json:"updated_groups"`
	StartedAt     int64  `json:"started_at"`
	FinishedAt    int64  `json:"finished_at"`
	DurationMS    int64  `json:"duration_ms"`
}

type ratioSyncRemoteGroup struct {
	Name  string  `json:"name"`
	Ratio float64 `json:"ratio"`
}

type ratioSyncRemoteKey struct {
	ID        int64      `json:"id"`
	Key       string     `json:"key"`
	Name      string     `json:"name"`
	GroupID   *int64     `json:"group_id"`
	Status    string     `json:"status"`
	ExpiresAt *time.Time `json:"expires_at"`
	Group     *struct {
		ID             int64   `json:"id"`
		Name           string  `json:"name"`
		Platform       string  `json:"platform"`
		RateMultiplier float64 `json:"rate_multiplier"`
	} `json:"group"`
}

type ratioSyncRemoteKeyResponse struct {
	ID            int64   `json:"id"`
	Name          string  `json:"name"`
	MaskedKey     string  `json:"masked_key"`
	Status        string  `json:"status"`
	GroupName     string  `json:"group_name"`
	GroupPlatform string  `json:"group_platform"`
	GroupRatio    float64 `json:"group_ratio"`
	Expired       bool    `json:"expired"`
}

type sub2APIAuthError struct {
	Status string
}

func (e *sub2APIAuthError) Error() string {
	return "sub2api authentication failed: " + e.Status
}

func (e *sub2APIAuthError) Unwrap() error {
	return errSub2APIAuthenticationInvalid
}

func loadRatioSyncAutoConfig() (ratioSyncAutoConfig, error) {
	common.OptionMapRWMutex.RLock()
	raw, found := common.OptionMap[ratioSyncAutoConfigOptionKey]
	common.OptionMapRWMutex.RUnlock()
	if !found || strings.TrimSpace(raw) == "" {
		return ratioSyncAutoConfig{}, nil
	}
	var config ratioSyncAutoConfig
	if err := common.UnmarshalJsonStr(raw, &config); err != nil {
		return ratioSyncAutoConfig{}, err
	}
	if config.KeyMappings == nil {
		config.KeyMappings = []ratioSyncKeyMapping{}
	}
	return config, nil
}

func validateRatioSyncAutoConfig(config ratioSyncAutoConfig) error {
	if !config.Enabled {
		return nil
	}
	if strings.TrimSpace(config.AccountID) == "" {
		return errors.New("saved sync account is required")
	}
	if config.IntervalMinutes < 1 || config.IntervalMinutes > 1440 {
		return errors.New("sync interval must be between 1 and 1440 minutes")
	}
	if len(config.KeyMappings) == 0 {
		return errors.New("configure at least one sub2api key mapping")
	}
	localGroups := make(map[string]struct{})
	for group := range ratio_setting.GetGroupRatioCopy() {
		localGroups[group] = struct{}{}
	}
	for group := range setting.GetUserUsableGroupsCopy() {
		localGroups[group] = struct{}{}
	}
	for _, mapping := range config.KeyMappings {
		targetGroup := strings.TrimSpace(mapping.GroupName)
		if mapping.KeyID <= 0 || targetGroup == "" {
			return errors.New("each selected sub2api key requires a target group")
		}
		if _, exists := localGroups[targetGroup]; !exists {
			return fmt.Errorf("target group %s does not exist", targetGroup)
		}
	}
	return nil
}

func GetRatioSyncAutoConfig(c *gin.Context) {
	config, err := loadRatioSyncAutoConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load automatic sync configuration"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": config})
}

func UpdateRatioSyncAutoConfig(c *gin.Context) {
	var config ratioSyncAutoConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid automatic sync configuration"})
		return
	}
	config.AccountID = strings.TrimSpace(config.AccountID)
	config.KeyMappings = normalizeRatioSyncKeyMappings(config.KeyMappings)
	if err := validateRatioSyncAutoConfig(config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	encoded, err := common.Marshal(config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to save automatic sync configuration"})
		return
	}
	if err := model.UpdateOption(ratioSyncAutoConfigOptionKey, string(encoded)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to save automatic sync configuration"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": config})
}

func RunRatioSyncNow(c *gin.Context) {
	config, err := loadRatioSyncAutoConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load automatic sync configuration"})
		return
	}
	config.Enabled = true
	if err := validateRatioSyncAutoConfig(config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	task, created, err := service.EnqueueSystemTask(
		model.SystemTaskTypeRatioSync,
		ratioSyncTaskPayload{Trigger: "manual"},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to start synchronization task"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": task.ToResponse(), "created": created})
}

func GetRatioSyncLogs(c *gin.Context) {
	limit := 5
	if parsed, err := strconv.Atoi(c.Query("limit")); err == nil && parsed > 0 {
		limit = parsed
	}
	tasks, err := model.ListSystemTasksByType(model.SystemTaskTypeRatioSync, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load synchronization logs"})
		return
	}
	responses := make([]model.SystemTaskResponse, 0, len(tasks))
	for _, task := range tasks {
		responses = append(responses, task.ToResponse())
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": responses})
}

func GetRatioSyncAccountKeys(c *gin.Context) {
	account, err := getRatioSyncAccount(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	keys, err := fetchRatioSyncAccountKeys(c.Request.Context(), account)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	now := time.Now()
	response := make([]ratioSyncRemoteKeyResponse, 0, len(keys))
	for _, key := range keys {
		item := ratioSyncRemoteKeyResponse{
			ID:        key.ID,
			Name:      key.Name,
			MaskedKey: maskRatioSyncKey(key.Key),
			Status:    key.Status,
			Expired:   key.ExpiresAt != nil && key.ExpiresAt.Before(now),
		}
		if key.Group != nil {
			item.GroupName = key.Group.Name
			item.GroupPlatform = key.Group.Platform
			item.GroupRatio = key.Group.RateMultiplier
		}
		response = append(response, item)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": response})
}

func GetRatioSyncAccountGroups(c *gin.Context) {
	account, err := getRatioSyncAccount(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	sources, err := fetchRatioSyncAccountSources(c.Request.Context(), account)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	groupsByName := map[string]float64{}
	for _, source := range sources {
		for name, value := range valueMap(source["group_ratio"]) {
			if ratio, ok := asFloat64(value); ok {
				groupsByName[name] = ratio
			}
		}
	}
	groups := make([]ratioSyncRemoteGroup, 0, len(groupsByName))
	for name, ratio := range groupsByName {
		groups = append(groups, ratioSyncRemoteGroup{Name: name, Ratio: ratio})
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].Name < groups[j].Name })
	c.JSON(http.StatusOK, gin.H{"success": true, "data": groups})
}

type ratioSyncHandler struct{}

func (ratioSyncHandler) Type() string { return model.SystemTaskTypeRatioSync }

func (ratioSyncHandler) Enabled() bool {
	config, err := loadRatioSyncAutoConfig()
	return err == nil && config.Enabled && validateRatioSyncAutoConfig(config) == nil
}

func (ratioSyncHandler) Interval() time.Duration {
	config, err := loadRatioSyncAutoConfig()
	if err != nil || config.IntervalMinutes < 1 {
		return time.Minute
	}
	return time.Duration(config.IntervalMinutes) * time.Minute
}

func (ratioSyncHandler) NewPayload() any {
	return ratioSyncTaskPayload{Trigger: "automatic"}
}

func (ratioSyncHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := ratioSyncTaskPayload{Trigger: "automatic"}
	if task.Payload != "" {
		_ = task.DecodePayload(&payload)
	}
	if payload.Trigger != "manual" {
		payload.Trigger = "automatic"
	}
	config, err := loadRatioSyncAutoConfig()
	summary := ratioSyncRunSummary{Trigger: payload.Trigger}
	if err == nil {
		summary, err = runRatioSyncAutoTask(ctx, config, payload.Trigger)
	}
	if err != nil {
		if errors.Is(err, errSub2APIAuthenticationInvalid) {
			notifyRatioSyncAuthenticationFailure(config, err)
		}
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, summary, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

func runRatioSyncAutoTask(ctx context.Context, config ratioSyncAutoConfig, trigger string) (summary ratioSyncRunSummary, runErr error) {
	started := time.Now()
	summary = ratioSyncRunSummary{
		Trigger:      trigger,
		AccountID:    config.AccountID,
		MappingCount: len(config.KeyMappings),
		StartedAt:    started.Unix(),
	}
	defer func() {
		finished := time.Now()
		summary.FinishedAt = finished.Unix()
		summary.DurationMS = finished.Sub(started).Milliseconds()
	}()
	if err := validateRatioSyncAutoConfig(config); err != nil {
		return summary, err
	}
	account, err := getRatioSyncAccount(config.AccountID)
	if err != nil {
		return summary, err
	}
	summary.AccountName = account.Name
	keys, err := fetchRatioSyncAccountKeys(ctx, account)
	if err != nil {
		return summary, err
	}
	sources, err := fetchRatioSyncAccountSources(ctx, account)
	if err != nil {
		return summary, err
	}

	mappingsByKeyID := make(map[int64]ratioSyncKeyMapping, len(config.KeyMappings))
	for _, mapping := range config.KeyMappings {
		mappingsByKeyID[mapping.KeyID] = mapping
	}
	selectedKeys := make([]ratioSyncRemoteKey, 0, len(config.KeyMappings))
	for _, key := range keys {
		if _, selected := mappingsByKeyID[key.ID]; selected {
			selectedKeys = append(selectedKeys, key)
		}
	}
	if len(selectedKeys) != len(mappingsByKeyID) {
		return summary, errors.New("one or more selected sub2api keys no longer exist")
	}

	for _, key := range selectedKeys {
		if key.Group == nil || strings.TrimSpace(key.Group.Name) == "" {
			return summary, fmt.Errorf("sub2api key %d has no assigned group", key.ID)
		}
	}
	summary.UpdatedModels, summary.UpdatedGroups, err = syncSelectedRatioData(sources, selectedKeys, mappingsByKeyID)
	return summary, err
}

func syncSelectedRatioData(
	sources map[string]map[string]any,
	selectedKeys []ratioSyncRemoteKey,
	mappingsByKeyID map[int64]ratioSyncKeyMapping,
) (int, int, error) {
	modelRatio := ratio_setting.GetModelRatioCopy()
	completionRatio := ratio_setting.GetCompletionRatioCopy()
	cacheRatio := ratio_setting.GetCacheRatioCopy()
	createCacheRatio := ratio_setting.GetCreateCacheRatioCopy()
	modelPrice := ratio_setting.GetModelPriceCopy()
	groupRatio := ratio_setting.GetGroupRatioCopy()
	updatedModels := 0
	updatedGroups := 0
	remoteToTargetGroups := make(map[string]map[string]struct{})
	for _, key := range selectedKeys {
		remoteGroup := strings.TrimSpace(key.Group.Name)
		targetGroup := mappingsByKeyID[key.ID].GroupName
		if remoteToTargetGroups[remoteGroup] == nil {
			remoteToTargetGroups[remoteGroup] = map[string]struct{}{}
		}
		remoteToTargetGroups[remoteGroup][targetGroup] = struct{}{}
	}

	sourceNames := make([]string, 0, len(sources))
	for name := range sources {
		sourceNames = append(sourceNames, name)
	}
	sort.Strings(sourceNames)
	for _, sourceName := range sourceNames {
		source := sources[sourceName]
		matches := false
		for group := range valueMap(source["group_ratio"]) {
			if _, ok := remoteToTargetGroups[group]; ok {
				matches = true
			}
		}
		if !matches {
			continue
		}
		for name, value := range valueMap(source["model_ratio"]) {
			if parsed, ok := asFloat64(value); ok {
				modelRatio[name] = parsed
				updatedModels++
			}
		}
		for name, value := range valueMap(source["completion_ratio"]) {
			if parsed, ok := asFloat64(value); ok {
				completionRatio[name] = parsed
			}
		}
		for name, value := range valueMap(source["cache_ratio"]) {
			if parsed, ok := asFloat64(value); ok {
				cacheRatio[name] = parsed
			}
		}
		for name, value := range valueMap(source["create_cache_ratio"]) {
			if parsed, ok := asFloat64(value); ok {
				createCacheRatio[name] = parsed
			}
		}
		for name, value := range valueMap(source["model_price"]) {
			if parsed, ok := asFloat64(value); ok {
				modelPrice[name] = parsed
				updatedModels++
			}
		}
		for group, value := range valueMap(source["group_ratio"]) {
			if parsed, ok := asFloat64(value); ok {
				for targetGroup := range remoteToTargetGroups[group] {
					groupRatio[targetGroup] = parsed
					updatedGroups++
				}
			}
		}
	}
	if updatedModels == 0 || updatedGroups == 0 {
		return updatedModels, updatedGroups, errors.New("selected sub2api key mappings have no importable ratios or prices")
	}
	updates := map[string]string{}
	for key, value := range map[string]any{
		"ModelRatio": modelRatio, "CompletionRatio": completionRatio,
		"CacheRatio": cacheRatio, "CreateCacheRatio": createCacheRatio,
		"ModelPrice": modelPrice, "GroupRatio": groupRatio,
	} {
		encoded, err := common.Marshal(value)
		if err != nil {
			return updatedModels, updatedGroups, err
		}
		updates[key] = string(encoded)
	}
	return updatedModels, updatedGroups, model.UpdateOptionsBulk(updates)
}

func getRatioSyncAccount(accountID string) (*ratioSyncAccount, error) {
	accounts, err := loadRatioSyncAccounts()
	if err != nil {
		return nil, err
	}
	for index := range accounts {
		if accounts[index].ID == accountID {
			return &accounts[index], nil
		}
	}
	return nil, errors.New("saved sync account not found")
}

func newRatioSyncHTTPClient(account *ratioSyncAccount) (*http.Client, error) {
	proxyURL, err := parseSyncProxyURL(account.ProxyURL)
	if err != nil {
		return nil, err
	}
	transport := &http.Transport{
		Proxy: http.ProxyURL(proxyURL), MaxIdleConns: 10,
		IdleConnTimeout: 90 * time.Second, TLSHandshakeTimeout: 10 * time.Second,
		ExpectContinueTimeout: time.Second, ResponseHeaderTimeout: 10 * time.Second,
		DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
	}
	if common.TLSInsecureSkipVerify {
		transport.TLSClientConfig = common.InsecureTLSConfig
	}
	return &http.Client{Transport: transport, Timeout: 30 * time.Second}, nil
}

func ratioSyncAccountToken(ctx context.Context, client *http.Client, account *ratioSyncAccount) (string, error) {
	token := strings.TrimSpace(account.APIKey)
	if token != "" {
		return token, nil
	}
	return loginSub2API(ctx, client, account.BaseURL, account.LoginEmail, account.LoginPassword, "")
}

func fetchRatioSyncAccountJSON(ctx context.Context, account *ratioSyncAccount, path string) ([]byte, error) {
	client, err := newRatioSyncHTTPClient(account)
	if err != nil {
		return nil, err
	}
	token, err := ratioSyncAccountToken(ctx, client, account)
	if err != nil {
		return nil, err
	}
	baseURL := strings.TrimRight(account.BaseURL, "/")
	if strings.HasSuffix(baseURL, "/api/v1") {
		baseURL = strings.TrimSuffix(baseURL, "/api/v1")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return nil, &sub2APIAuthError{Status: response.Status}
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sub2api request failed: %s", response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, maxRatioConfigBytes))
}

func fetchRatioSyncAccountKeys(ctx context.Context, account *ratioSyncAccount) ([]ratioSyncRemoteKey, error) {
	keys := make([]ratioSyncRemoteKey, 0)
	for page := 1; ; page++ {
		body, err := fetchRatioSyncAccountJSON(ctx, account, fmt.Sprintf("/api/v1/keys?page=%d&page_size=100", page))
		if err != nil {
			return nil, err
		}
		var response struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Data    struct {
				Items []ratioSyncRemoteKey `json:"items"`
				Pages int                  `json:"pages"`
			} `json:"data"`
		}
		if err := common.Unmarshal(body, &response); err != nil {
			return nil, fmt.Errorf("decode sub2api key list: %w", err)
		}
		if response.Code != 0 {
			return nil, fmt.Errorf("sub2api key list failed: %s", response.Message)
		}
		keys = append(keys, response.Data.Items...)
		if page >= response.Data.Pages || response.Data.Pages <= 1 {
			break
		}
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].ID < keys[j].ID })
	return keys, nil
}

func fetchRatioSyncAccountSources(ctx context.Context, account *ratioSyncAccount) (map[string]map[string]any, error) {
	body, err := fetchRatioSyncAccountJSON(ctx, account, sub2APIAvailableChannelsPath)
	if err != nil {
		return nil, err
	}
	sources, err := convertSub2APIToRatioData(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	formula, err := compileRatioFormula(account.RatioFormula)
	if err != nil {
		return nil, err
	}
	for _, source := range sources {
		if err := applyRatioFormula(source, formula); err != nil {
			return nil, err
		}
	}
	return sources, nil
}

func normalizeRatioSyncKeyMappings(mappings []ratioSyncKeyMapping) []ratioSyncKeyMapping {
	byKeyID := make(map[int64]ratioSyncKeyMapping, len(mappings))
	for _, mapping := range mappings {
		mapping.GroupName = strings.TrimSpace(mapping.GroupName)
		if mapping.KeyID > 0 && mapping.GroupName != "" {
			byKeyID[mapping.KeyID] = mapping
		}
	}
	result := make([]ratioSyncKeyMapping, 0, len(byKeyID))
	for _, mapping := range byKeyID {
		result = append(result, mapping)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].KeyID < result[j].KeyID })
	return result
}

func maskRatioSyncKey(key string) string {
	key = strings.TrimSpace(key)
	if len(key) <= 10 {
		return "********"
	}
	return key[:6] + "..." + key[len(key)-4:]
}

func notifyRatioSyncAuthenticationFailure(config ratioSyncAutoConfig, syncErr error) {
	root := model.GetRootUser()
	if root == nil {
		common.SysLog("failed to notify ratio sync authentication failure: root user not found")
		return
	}
	accountName := config.AccountID
	if account, err := getRatioSyncAccount(config.AccountID); err == nil {
		accountName = account.Name + " (" + account.BaseURL + ")"
	}
	userSetting := root.GetSetting()
	userSetting.NotifyType = dto.NotifyTypeEmail
	notification := dto.NewNotify(
		"ratio_sync_authentication_failure",
		"sub2api automatic sync authentication expired",
		fmt.Sprintf("The JWT for %s is no longer valid. Update the saved account before the next synchronization. Error: %s", accountName, syncErr.Error()),
		nil,
	)
	if err := service.NotifyUser(root.Id, root.Email, userSetting, notification); err != nil {
		common.SysLog("failed to email ratio sync authentication failure: " + err.Error())
	}
}
