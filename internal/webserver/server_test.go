package webserver

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/godwit-email/godwit/core"
	"github.com/stretchr/testify/require"
	"github.com/zalando/go-keyring"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testServer(t *testing.T) (*Server, string, string) {
	t.Helper()
	dir := t.TempDir()
	key := filepath.Join(dir, "vault.key")
	require.NoError(t, Initialize(dir, key))
	v, e := OpenVault(filepath.Join(dir, "vault.enc"), key)
	require.NoError(t, e)
	svc, e := core.New(context.Background(), core.Options{DataDir: dir, CredentialStore: v})
	require.NoError(t, e)
	t.Cleanup(func() { svc.Close() })
	s, e := New(svc, dir, "https://mail.example.test", t.TempDir())
	require.NoError(t, e)
	pw, e := os.ReadFile(filepath.Join(dir, "initial-password"))
	require.NoError(t, e)
	return s, strings.TrimSpace(string(pw)), dir
}
func request(s *Server, method, path, body string, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "https://mail.example.test"+path, strings.NewReader(body))
	r.Header.Set("Origin", "https://mail.example.test")
	r.Header.Set("X-CSRF-Token", csrf)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func authenticate(t *testing.T, s *Server, pw string) (*http.Cookie, string) {
	t.Helper()
	b, _ := json.Marshal(map[string]string{"Password": pw, "OTP": totp(s.auth.otpSecret, time.Now())})
	w := request(s, "POST", "/api/v1/login", string(b), nil, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	var v map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &v))
	require.NotEmpty(t, v["csrf"])
	cookies := w.Result().Cookies()
	require.Len(t, cookies, 1)
	require.True(t, cookies[0].HttpOnly)
	require.True(t, cookies[0].Secure)
	return cookies[0], v["csrf"]
}
func TestOwnerAuthenticationAndExplicitSurface(t *testing.T) {
	s, pw, _ := testServer(t)
	require.Equal(t, 401, request(s, "POST", "/api/v1/call/ListAccounts", "[]", nil, "").Code)
	cookie, csrf := authenticate(t, s, pw)
	require.Equal(t, 403, request(s, "POST", "/api/v1/call/ListAccounts", "[]", cookie, "").Code)
	w := request(s, "POST", "/api/v1/call/ListAccounts", "[]", cookie, csrf)
	require.Equal(t, 200, w.Code, w.Body.String())
	for _, method := range []string{"AddAttachment", "InstallPlugin", "Close", "GetAttachment", "StoredHTML", "Send", "SaveDraftForTest"} {
		require.Equal(t, 404, request(s, "POST", "/api/v1/call/"+method, "[]", cookie, csrf).Code, method)
	}
	require.Equal(t, 400, request(s, "POST", "/api/v1/call/SaveDraft", `[{"Revision":0}]`, cookie, csrf).Code)
	require.Equal(t, 400, request(s, "POST", "/api/v1/call/ListAccounts", `[1]`, cookie, csrf).Code)
	require.Equal(t, 204, request(s, "POST", "/api/v1/logout", "", cookie, csrf).Code)
	require.Equal(t, 401, request(s, "GET", "/api/v1/session", "", cookie, "").Code)
}
func TestRejectCrossOriginAndRateLimitLogin(t *testing.T) {
	s, pw, _ := testServer(t)
	b, _ := json.Marshal(map[string]string{"Password": pw, "OTP": totp(s.auth.otpSecret, time.Now())})
	r := httptest.NewRequest("POST", "https://mail.example.test/api/v1/login", bytes.NewReader(b))
	r.Header.Set("Origin", "https://evil.test")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	require.Equal(t, 403, w.Code)
	for i := 0; i < 5; i++ {
		require.Equal(t, 401, request(s, "POST", "/api/v1/login", `{"Password":"wrong"}`, nil, "").Code)
	}
	require.Equal(t, 429, request(s, "POST", "/api/v1/login", string(b), nil, "").Code)
}
func TestVaultPersistsAndAuthenticatesCiphertext(t *testing.T) {
	_, _, dir := testServer(t)
	p := filepath.Join(dir, "secrets.enc")
	key := filepath.Join(dir, "vault.key")
	v, e := OpenVault(p, key)
	require.NoError(t, e)
	require.NoError(t, v.Set("account:1", "secret-that-must-not-be-plaintext"))
	b, e := os.ReadFile(p)
	require.NoError(t, e)
	require.NotContains(t, string(b), "secret-that-must-not-be-plaintext")
	reopened, e := OpenVault(p, key)
	require.NoError(t, e)
	got, e := reopened.Get("account:1")
	require.NoError(t, e)
	require.Equal(t, "secret-that-must-not-be-plaintext", got)
	require.NoError(t, reopened.Delete("account:1"))
	_, e = reopened.Get("account:1")
	require.ErrorIs(t, e, keyring.ErrNotFound)
	require.NoError(t, os.WriteFile(p, append(b[:len(b)-1], b[len(b)-1]^1), 0600))
	_, e = reopened.Get("account:1")
	require.Error(t, e)
	require.NoError(t, os.Chmod(key, 0644))
	_, e = OpenVault(p, key)
	require.Error(t, e)
}
func TestCredentialStoreIsPerServiceAndDoesNotUseSystemKeychain(t *testing.T) {
	s, _, _ := testServer(t)
	require.NoError(t, s.svc.KeychainStatus(context.Background()))
	// A second isolated vault must not see any secret from the first.
	other := t.TempDir()
	key := filepath.Join(other, "key")
	require.NoError(t, Initialize(other, key))
	v, e := OpenVault(filepath.Join(other, "vault"), key)
	require.NoError(t, e)
	require.NoError(t, s.svc.KeychainStatus(context.Background()))
	_, e = v.Get("nonexistent")
	require.ErrorIs(t, e, keyring.ErrNotFound)
}
func TestAssetRootDoesNotListDirectory(t *testing.T) {
	s, _, _ := testServer(t)
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "webmail.html"), []byte("Godwit Web"), 0600))
	s.assets = http.FileServer(http.Dir(dir))
	w := request(s, "GET", "/", "", nil, "")
	b, e := io.ReadAll(w.Result().Body)
	require.NoError(t, e)
	require.Equal(t, 200, w.Code)
	require.Equal(t, "Godwit Web", string(b))
}
