package webserver

import (
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestTOTPStandardVectorAndWindow(t *testing.T) {
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	at := time.Unix(59, 0)
	require.Equal(t, "287082", totp(secret, at))
	step, ok := validOTP(secret, "287082", at)
	require.True(t, ok)
	require.Equal(t, int64(1), step)
	_, ok = validOTP(secret, "287082", at.Add(61*time.Second))
	require.False(t, ok)
	_, ok = validOTP(secret, "", at)
	require.False(t, ok)
}
