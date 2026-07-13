package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseChannelStatusModelsTrimsAndDeduplicates(t *testing.T) {
	models := parseChannelStatusModels(" gpt-4, ,gpt-4, claude-4 ")

	require.Equal(t, []string{"gpt-4", "claude-4"}, models)
}
