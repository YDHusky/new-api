package controller

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/require"

	"github.com/gin-gonic/gin"
)

func TestSub2APIAvailableChannelsURL(t *testing.T) {
	require.Equal(t, "https://sub2api.example.com/api/v1/channels/available", sub2APIAvailableChannelsURL("https://sub2api.example.com"))
	require.Equal(t, "https://sub2api.example.com/api/v1/channels/available", sub2APIAvailableChannelsURL("https://sub2api.example.com/api/v1/"))
}

func TestParseSyncProxyURL(t *testing.T) {
	proxyURL, err := parseSyncProxyURL("http://localhost:7897")
	require.NoError(t, err)
	require.Equal(t, "http://localhost:7897", proxyURL.String())

	_, err = parseSyncProxyURL("socks5://localhost:7897")
	require.Error(t, err)
}

func TestRatioSyncAccountAllowsSavedProxyWithoutExposingCredentials(t *testing.T) {
	account := ratioSyncAccount{
		ID:            "account-1",
		Name:          "sub2api",
		BaseURL:       "https://sub2api.example.com",
		AuthMode:      "account-login",
		LoginEmail:    "admin@example.com",
		LoginPassword: "secret-password",
		ProxyURL:      "http://localhost:7897",
	}
	require.NoError(t, validateRatioSyncAccount(account))

	response, err := common.Marshal(ratioSyncAccountResponse{
		ID:         account.ID,
		Name:       account.Name,
		BaseURL:    account.BaseURL,
		AuthMode:   account.AuthMode,
		LoginEmail: account.LoginEmail,
		ProxyURL:   account.ProxyURL,
	})
	require.NoError(t, err)
	require.NotContains(t, string(response), account.LoginPassword)
}

func TestConvertSub2APIToRatioDataKeepsGroupRateSeparate(t *testing.T) {
	data, err := convertSub2APIToRatioData(strings.NewReader(`{
  "code": 0,
  "message": "success",
  "data": [
    {
      "name": "sub2api-main",
      "platforms": [
        {
          "platform": "openai",
          "groups": [{"name": "standard", "rate_multiplier": 1.2}],
          "supported_models": [
            {
              "name": "gpt-test",
              "pricing": {
                "input_price": 0.000002,
                "output_price": 0.000006,
                "cache_read_price": 0.0000005
              }
            },
            {
              "name": "image-test",
              "pricing": {"per_request_price": 0.04}
            }
          ]
        }
      ]
    }
  ]
}`))
	require.NoError(t, err)

	source := data["sub2api-main / openai / standard"]
	require.NotNil(t, source)
	require.Equal(t, 1.0, valueMap(source["model_ratio"])["gpt-test"])
	require.Equal(t, 3.0, valueMap(source["completion_ratio"])["gpt-test"])
	require.Equal(t, 0.25, valueMap(source["cache_ratio"])["gpt-test"])
	require.Equal(t, 0.04, valueMap(source["model_price"])["image-test"])
	require.Equal(t, 1.2, valueMap(source["group_ratio"])["standard"])
	require.Equal(t, []string{"gpt-test", "image-test"}, source["supported_models"])
}

func TestFetchRatioSyncAccountKeysPaginatesAndKeepsGroupMetadata(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer source-jwt", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Query().Get("page") {
		case "1":
			_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"id":11,"key":"sk-first-1234567890","name":"first","status":"active","group":{"id":2,"name":"standard","platform":"openai","rate_multiplier":1.2}}],"pages":2}}`))
		case "2":
			_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"id":12,"key":"sk-second-1234567890","name":"second","status":"active","group":{"id":3,"name":"plus","platform":"anthropic","rate_multiplier":1.5}}],"pages":2}}`))
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer upstream.Close()

	keys, err := fetchRatioSyncAccountKeys(context.Background(), &ratioSyncAccount{
		BaseURL: upstream.URL,
		APIKey:  "source-jwt",
	})
	require.NoError(t, err)
	require.Len(t, keys, 2)
	require.Equal(t, int64(11), keys[0].ID)
	require.Equal(t, "standard", keys[0].Group.Name)
	require.Equal(t, 1.5, keys[1].Group.RateMultiplier)
	require.Equal(t, "sk-fir...7890", maskRatioSyncKey(keys[0].Key))
}

func TestFetchRatioSyncAccountKeysClassifiesExpiredJWT(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer upstream.Close()

	_, err := fetchRatioSyncAccountKeys(context.Background(), &ratioSyncAccount{
		BaseURL: upstream.URL,
		APIKey:  "expired-jwt",
	})
	require.Error(t, err)
	require.True(t, errors.Is(err, errSub2APIAuthenticationInvalid))
}

func TestNormalizeRatioSyncKeyMappingsUsesOneTargetGroupPerKey(t *testing.T) {
	mappings := normalizeRatioSyncKeyMappings([]ratioSyncKeyMapping{
		{KeyID: 12, GroupName: " premium "},
		{KeyID: 11, GroupName: "standard"},
		{KeyID: 12, GroupName: "premium-v2"},
		{KeyID: 0, GroupName: "ignored"},
		{KeyID: 13, GroupName: " "},
	})

	require.Equal(t, []ratioSyncKeyMapping{
		{KeyID: 11, GroupName: "standard"},
		{KeyID: 12, GroupName: "premium-v2"},
	}, mappings)
}

func TestValidateRatioSyncAutoConfigRequiresTargetGroup(t *testing.T) {
	err := validateRatioSyncAutoConfig(ratioSyncAutoConfig{
		Enabled:         true,
		AccountID:       "account-1",
		IntervalMinutes: 60,
		KeyMappings: []ratioSyncKeyMapping{
			{KeyID: 11, GroupName: ""},
		},
	})
	require.EqualError(t, err, "each selected sub2api key requires a target group")
}

func TestApplyRatioFormulaSupportsChineseVariable(t *testing.T) {
	program, err := compileRatioFormula("倍率 + 0.1")
	require.NoError(t, err)

	data := map[string]any{
		"model_ratio": map[string]any{"gpt-test": 1.2},
		"group_ratio": map[string]any{"standard": 1.2},
	}
	require.NoError(t, applyRatioFormula(data, program))
	require.Equal(t, 1.3, valueMap(data["model_ratio"])["gpt-test"])
	require.Equal(t, 1.3, valueMap(data["group_ratio"])["standard"])
}

func TestApplyRatioFormulaRejectsNegativeResult(t *testing.T) {
	program, err := compileRatioFormula("value - 2")
	require.NoError(t, err)

	err = applyRatioFormula(map[string]any{
		"model_ratio": map[string]any{"gpt-test": 1.2},
	}, program)
	require.Error(t, err)
}

func TestFetchUpstreamRatiosFromSub2APIUsesAPIKeyAndFormula(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != sub2APIAvailableChannelsPath || r.Header.Get("Authorization") != "Bearer source-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
  "code": 0,
  "data": [{
    "name": "source",
    "platforms": [{
      "platform": "openai",
      "groups": [{"name": "default", "rate_multiplier": 1}],
      "supported_models": [{
        "name": "sub2api-import-test-model",
        "pricing": {"input_price": 0.000002, "output_price": 0.000004}
      }]
    }]
  }]
}`))
	}))
	defer upstream.Close()

	body, err := common.Marshal(dto.UpstreamRequest{
		Upstreams: []dto.UpstreamDTO{{
			Name:     "sub2api",
			BaseURL:  upstream.URL,
			Endpoint: sub2APIEndpoint,
			APIKey:   "source-key",
		}},
		RatioFormula: "value + 0.1",
	})
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/ratio-sync/fetch", FetchUpstreamRatios)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/ratio-sync/fetch", strings.NewReader(string(body)))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code)

	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Differences      map[string]map[string]dto.DifferenceItem `json:"differences"`
			GroupDifferences map[string]dto.DifferenceItem            `json:"group_differences"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Equal(t, 1.1, response.Data.Differences["sub2api-import-test-model"]["model_ratio"].Upstreams["sub2api / source / openai / default"])
	require.Equal(t, 1.1, response.Data.GroupDifferences["default"].Upstreams["sub2api / source / openai / default"])
}

func TestFetchUpstreamRatiosFromSub2APILogin(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/login":
			require.Equal(t, http.MethodPost, r.Method)
			var request sub2APILoginRequest
			require.NoError(t, common.DecodeJson(r.Body, &request))
			require.Equal(t, "admin@example.com", request.Email)
			require.Equal(t, "source-password", request.Password)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":0,"data":{"access_token":"session-token"}}`))
		case sub2APIAvailableChannelsPath:
			require.Equal(t, "Bearer session-token", r.Header.Get("Authorization"))
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
  "code": 0,
  "data": [{
    "name": "source",
    "platforms": [{
      "platform": "openai",
      "groups": [{"name": "default", "rate_multiplier": 1}],
      "supported_models": [{
        "name": "sub2api-login-test-model",
        "pricing": {"input_price": 0.000002}
      }]
    }]
  }]
}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()

	body, err := common.Marshal(dto.UpstreamRequest{
		Upstreams: []dto.UpstreamDTO{{
			Name:          "sub2api",
			BaseURL:       upstream.URL,
			Endpoint:      sub2APIEndpoint,
			LoginEmail:    "admin@example.com",
			LoginPassword: "source-password",
		}},
	})
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/ratio-sync/fetch", FetchUpstreamRatios)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/ratio-sync/fetch", strings.NewReader(string(body)))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code)

	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
}

func TestLoginSub2APISupportsTwoFactorLogin(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/auth/login":
			_, _ = w.Write([]byte(`{"code":0,"data":{"requires_2fa":true,"temp_token":"pending-token"}}`))
		case "/api/v1/auth/login/2fa":
			var request sub2APILogin2FARequest
			require.NoError(t, common.DecodeJson(r.Body, &request))
			require.Equal(t, "pending-token", request.TempToken)
			require.Equal(t, "123456", request.TOTPCode)
			_, _ = w.Write([]byte(`{"code":0,"data":{"access_token":"two-factor-token"}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()

	token, err := loginSub2API(
		context.Background(),
		upstream.Client(),
		upstream.URL,
		"admin@example.com",
		"source-password",
		"123456",
	)
	require.NoError(t, err)
	require.Equal(t, "two-factor-token", token)
}

func TestMergeRatioSyncAccountPreservesStoredSecretAndUpdatesFormula(t *testing.T) {
	existing := ratioSyncAccount{
		ID:           "account-1",
		Name:         "old name",
		BaseURL:      "https://old.example.com",
		AuthMode:     "api-key",
		APIKey:       "stored-jwt",
		ProxyURL:     "http://localhost:7897",
		RatioFormula: "value + 0.1",
	}

	updated, err := mergeRatioSyncAccount(existing, ratioSyncAccountRequest{
		Name:         "new name",
		BaseURL:      "https://new.example.com/",
		AuthMode:     "api-key",
		ProxyURL:     "",
		RatioFormula: "value * 1.2",
	})
	require.NoError(t, err)
	require.Equal(t, "stored-jwt", updated.APIKey)
	require.Equal(t, "https://new.example.com", updated.BaseURL)
	require.Equal(t, "", updated.ProxyURL)
	require.Equal(t, "value * 1.2", updated.RatioFormula)
}

func TestMergeRatioSyncAccountRequiresSecretWhenChangingAuthMode(t *testing.T) {
	_, err := mergeRatioSyncAccount(ratioSyncAccount{
		ID:       "account-1",
		Name:     "source",
		BaseURL:  "https://source.example.com",
		AuthMode: "api-key",
		APIKey:   "stored-jwt",
	}, ratioSyncAccountRequest{
		Name:       "source",
		BaseURL:    "https://source.example.com",
		AuthMode:   "account-login",
		LoginEmail: "admin@example.com",
	})
	require.EqualError(t, err, "account email and password are required")
}
