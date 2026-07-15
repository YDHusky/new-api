package controller

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	ratioSyncAccountsOptionKey = "RatioSyncAccountsSecret"
	maxRatioSyncAccounts       = 20
)

type ratioSyncAccount struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	BaseURL       string `json:"base_url"`
	AuthMode      string `json:"auth_mode"`
	APIKey        string `json:"api_key"`
	LoginEmail    string `json:"login_email"`
	LoginPassword string `json:"login_password"`
	ProxyURL      string `json:"proxy_url"`
	RatioFormula  string `json:"ratio_formula"`
}

type ratioSyncAccountResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	BaseURL      string `json:"base_url"`
	AuthMode     string `json:"auth_mode"`
	LoginEmail   string `json:"login_email,omitempty"`
	ProxyURL     string `json:"proxy_url,omitempty"`
	RatioFormula string `json:"ratio_formula,omitempty"`
}

type ratioSyncAccountRequest struct {
	Name          string `json:"name" binding:"required"`
	BaseURL       string `json:"base_url" binding:"required"`
	AuthMode      string `json:"auth_mode" binding:"required"`
	APIKey        string `json:"api_key"`
	LoginEmail    string `json:"login_email"`
	LoginPassword string `json:"login_password"`
	ProxyURL      string `json:"proxy_url"`
	RatioFormula  string `json:"ratio_formula"`
}

func ratioSyncAccountToResponse(account ratioSyncAccount) ratioSyncAccountResponse {
	return ratioSyncAccountResponse{
		ID:           account.ID,
		Name:         account.Name,
		BaseURL:      account.BaseURL,
		AuthMode:     account.AuthMode,
		LoginEmail:   account.LoginEmail,
		ProxyURL:     account.ProxyURL,
		RatioFormula: account.RatioFormula,
	}
}

func saveRatioSyncAccounts(accounts []ratioSyncAccount) error {
	encoded, err := common.Marshal(accounts)
	if err != nil {
		return err
	}
	return model.UpdateOption(ratioSyncAccountsOptionKey, string(encoded))
}

func mergeRatioSyncAccount(existing ratioSyncAccount, request ratioSyncAccountRequest) (ratioSyncAccount, error) {
	account := existing
	account.Name = strings.TrimSpace(request.Name)
	account.BaseURL = strings.TrimRight(strings.TrimSpace(request.BaseURL), "/")
	account.AuthMode = request.AuthMode
	account.ProxyURL = strings.TrimSpace(request.ProxyURL)
	account.RatioFormula = strings.TrimSpace(request.RatioFormula)

	switch request.AuthMode {
	case "api-key":
		if strings.TrimSpace(request.APIKey) != "" {
			account.APIKey = strings.TrimSpace(request.APIKey)
		} else if existing.AuthMode != "api-key" {
			account.APIKey = ""
		}
		account.LoginEmail = ""
		account.LoginPassword = ""
	case "account-login":
		account.LoginEmail = strings.TrimSpace(request.LoginEmail)
		if request.LoginPassword != "" {
			account.LoginPassword = request.LoginPassword
		} else if existing.AuthMode != "account-login" {
			account.LoginPassword = ""
		}
		account.APIKey = ""
	default:
		return ratioSyncAccount{}, newRatioSyncAccountError("unsupported authentication method")
	}
	if err := validateRatioSyncAccount(account); err != nil {
		return ratioSyncAccount{}, err
	}
	return account, nil
}

func loadRatioSyncAccounts() ([]ratioSyncAccount, error) {
	raw, err := model.GetOptionValue(ratioSyncAccountsOptionKey)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return []ratioSyncAccount{}, nil
		}
		return nil, err
	}
	if strings.TrimSpace(raw) == "" {
		return []ratioSyncAccount{}, nil
	}
	var accounts []ratioSyncAccount
	if err := common.UnmarshalJsonStr(raw, &accounts); err != nil {
		return nil, err
	}
	return accounts, nil
}

func validateRatioSyncAccount(account ratioSyncAccount) error {
	if strings.TrimSpace(account.Name) == "" {
		return newRatioSyncAccountError("account name is required")
	}
	parsedURL, err := url.ParseRequestURI(strings.TrimSpace(account.BaseURL))
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
		return newRatioSyncAccountError("account URL must use http or https and include a host")
	}
	switch account.AuthMode {
	case "api-key":
		if strings.TrimSpace(account.APIKey) == "" {
			return newRatioSyncAccountError("API key is required")
		}
	case "account-login":
		if strings.TrimSpace(account.LoginEmail) == "" || account.LoginPassword == "" {
			return newRatioSyncAccountError("account email and password are required")
		}
	default:
		return newRatioSyncAccountError("unsupported authentication method")
	}
	if _, err := parseSyncProxyURL(account.ProxyURL); err != nil {
		return err
	}
	if _, err := compileRatioFormula(account.RatioFormula); err != nil {
		return err
	}
	return nil
}

type ratioSyncAccountError string

func (e ratioSyncAccountError) Error() string {
	return string(e)
}

func newRatioSyncAccountError(message string) error {
	return ratioSyncAccountError(message)
}

func GetRatioSyncAccounts(c *gin.Context) {
	accounts, err := loadRatioSyncAccounts()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load saved sync accounts"})
		return
	}
	response := make([]ratioSyncAccountResponse, 0, len(accounts))
	for _, account := range accounts {
		response = append(response, ratioSyncAccountToResponse(account))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": response})
}

func CreateRatioSyncAccount(c *gin.Context) {
	var request ratioSyncAccountRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid saved sync account"})
		return
	}
	accounts, err := loadRatioSyncAccounts()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load saved sync accounts"})
		return
	}
	if len(accounts) >= maxRatioSyncAccounts {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "saved sync account limit reached"})
		return
	}
	identifier := make([]byte, 12)
	if _, err := rand.Read(identifier); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to create saved sync account"})
		return
	}
	account := ratioSyncAccount{
		ID:            hex.EncodeToString(identifier),
		Name:          strings.TrimSpace(request.Name),
		BaseURL:       strings.TrimRight(strings.TrimSpace(request.BaseURL), "/"),
		AuthMode:      request.AuthMode,
		APIKey:        strings.TrimSpace(request.APIKey),
		LoginEmail:    strings.TrimSpace(request.LoginEmail),
		LoginPassword: request.LoginPassword,
		ProxyURL:      strings.TrimSpace(request.ProxyURL),
		RatioFormula:  strings.TrimSpace(request.RatioFormula),
	}
	if err := validateRatioSyncAccount(account); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	accounts = append(accounts, account)
	if err := saveRatioSyncAccounts(accounts); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to save sync account"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": ratioSyncAccountToResponse(account)})
}

func UpdateRatioSyncAccount(c *gin.Context) {
	var request ratioSyncAccountRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid saved sync account"})
		return
	}
	accounts, err := loadRatioSyncAccounts()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load saved sync accounts"})
		return
	}
	accountID := c.Param("id")
	for index := range accounts {
		if accounts[index].ID != accountID {
			continue
		}
		updated, err := mergeRatioSyncAccount(accounts[index], request)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		accounts[index] = updated
		if err := saveRatioSyncAccounts(accounts); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to save sync account"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": ratioSyncAccountToResponse(updated)})
		return
	}
	c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "saved sync account not found"})
}

func DeleteRatioSyncAccount(c *gin.Context) {
	accounts, err := loadRatioSyncAccounts()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load saved sync accounts"})
		return
	}
	accountID := c.Param("id")
	remaining := make([]ratioSyncAccount, 0, len(accounts))
	found := false
	for _, account := range accounts {
		if account.ID == accountID {
			found = true
			continue
		}
		remaining = append(remaining, account)
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "saved sync account not found"})
		return
	}
	if err := saveRatioSyncAccounts(remaining); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to delete sync account"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
