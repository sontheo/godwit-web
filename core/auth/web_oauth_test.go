package auth

import (
	"context"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestWebOAuthUsesRegisteredHTTPSRedirectAndRejectsWrongState(t *testing.T) {
	f, e := StartFlow(OAuthConfig{ClientID: "web-client", AuthURL: "https://provider.test/authorize", TokenURL: "https://provider.test/token", RedirectURL: "https://mail.example.test/oauth/callback", Scopes: []string{"email"}}, "", http.DefaultClient)
	require.NoError(t, e)
	defer f.Close()
	require.Nil(t, f.ln)
	u, e := url.Parse(f.AuthURL())
	require.NoError(t, e)
	require.Equal(t, "https://mail.example.test/oauth/callback", u.Query().Get("redirect_uri"))
	require.NotEmpty(t, u.Query().Get("code_challenge"))
	r := httptest.NewRequest("GET", "https://mail.example.test/oauth/callback?state=wrong&code=secret", nil)
	w := httptest.NewRecorder()
	f.ServeHTTP(w, r)
	require.False(t, f.claimed.Load())
	require.NotContains(t, w.Body.String(), "secret")
	f.Close()
	_, e = f.Wait(context.Background())
	require.ErrorIs(t, e, context.Canceled)
}
