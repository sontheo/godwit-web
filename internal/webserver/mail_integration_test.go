package webserver

import (
	"context"
	"encoding/json"
	"github.com/godwit-email/godwit/core"
	"github.com/godwit-email/godwit/core/coretest"
	"github.com/stretchr/testify/require"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// This exercises the HTTP adapter against real protocol exchanges with the
// upstream IMAP/SMTP fixtures, without credentials or a real external mailbox.
func TestHTTPMailReadDraftConflictAndAtMostOnceSend(t *testing.T) {
	env := coretest.New(t, coretest.WithoutAutoSync())
	acc := env.AddAccount(t, "owner@example.test")
	env.Deliver(t, acc.ID, "INBOX", coretest.Msg("sender@example.test", acc.Email, "웹 메일 테스트", "plain text", coretest.HTML(`<p>안녕하세요</p><script>alert('bad')</script><img src="https://tracker.test/pixel" width="1" height="1">`)))
	require.NoError(t, Initialize(env.DataDir, filepath.Join(env.DataDir, "vault.key")))
	s, e := New(env.Svc, env.DataDir, "https://mail.example.test", t.TempDir())
	require.NoError(t, e)
	pw, e := os.ReadFile(filepath.Join(env.DataDir, "initial-password"))
	require.NoError(t, e)
	cookie, csrf := authenticate(t, s, strings.TrimSpace(string(pw)))
	invoke := func(name string, params ...any) []byte {
		b, e := json.Marshal(params)
		require.NoError(t, e)
		w := request(s, "POST", "/api/v1/call/"+name, string(b), cookie, csrf)
		require.Equal(t, 200, w.Code, w.Body.String())
		return w.Body.Bytes()
	}
	var page core.MessagePage
	require.NoError(t, json.Unmarshal(invoke("ListMessages", core.View{Unified: "inbox"}, "", 100), &page))
	require.Len(t, page.Items, 1)
	id := page.Items[0].ID
	w := request(s, "GET", "/api/v1/body/"+strconv.FormatInt(id, 10), "", cookie, "")
	require.Equal(t, 200, w.Code)
	require.Contains(t, w.Body.String(), "안녕하세요")
	require.NotContains(t, w.Body.String(), "<script>")
	require.NotContains(t, w.Body.String(), "https://tracker.test")
	require.Contains(t, w.Header().Get("Content-Security-Policy"), "sandbox")
	var draft core.Draft
	require.NoError(t, json.Unmarshal(invoke("NewDraft", acc.ID, "reply", id), &draft))
	draft.HTML = "<p>답장 테스트</p>"
	var updated core.Draft
	require.NoError(t, json.Unmarshal(invoke("SaveDraft", draft), &updated))
	require.Greater(t, updated.Revision, draft.Revision)
	stale, _ := json.Marshal([]any{draft})
	require.Equal(t, 409, request(s, "POST", "/api/v1/call/SaveDraft", string(stale), cookie, csrf).Code)
	invoke("SendRevision", updated.ID, updated.Revision)
	duplicate, _ := json.Marshal([]any{updated.ID, updated.Revision})
	require.Equal(t, 409, request(s, "POST", "/api/v1/call/SendRevision", string(duplicate), cookie, csrf).Code)
	env.AdvanceClock(11 * time.Second)
	require.NoError(t, env.Svc.SyncNow(context.Background(), acc.ID))
	require.Len(t, env.Sent(acc.ID), 1)
}
