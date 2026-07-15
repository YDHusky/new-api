package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetUserUsableGroupsDoesNotExposeNonSelectableUserGroup(t *testing.T) {
	original, err := common.Marshal(setting.GetUserUsableGroupsCopy())
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(string(original)))
	})

	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))

	groups := GetUserUsableGroups("private")
	assert.Contains(t, groups, "default")
	assert.NotContains(t, groups, "private")
}
