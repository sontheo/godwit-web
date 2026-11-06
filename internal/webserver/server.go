// Package webserver adapts the existing mail engine to an authenticated web UI.
package webserver

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/godwit-email/godwit/core"
	"github.com/godwit-email/godwit/rpc"
	"github.com/godwit-email/godwit/rpcbind"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Methods is an explicit browser surface, independent of the desktop full role.
// Sending is exposed only to the authenticated owner, never to an AI role.
const Methods = `ListAccounts AddAccount TestAccount UpdateAccount UpdatePassword RemoveAccount DetectProvider ListProviders ReorderAccounts Reauthorize BeginOAuth AwaitOAuth CancelOAuth
ListFolders SetRoleFolder ListMessages ListThreads GetThread GetMessage GetMessageText Search SearchWith Find SetFlags MarkAllAsRead Move MoveToRole Delete DeleteForever EmptyFolder UndoPurge SyncNow PendingOps
NewDraft GetDraft SaveDraft DeleteDraft ListDrafts SetDraftAccount RemoveAttachmentAt SendRevision SendAcknowledgedRevision ListOutbox CancelOutbox ResolveOutbox
GetSettings SetSettings ListLabels AllAccountLabels CreateLabel UpdateLabel DeleteLabel SetLabel ReorderLabels MessageLabels ThreadLabels
Contacts ContactDetail ContactMail BlockSender UnblockSender BlockedSenders ArchiveSender UndoArchive Unsubscribe UnsubscribeMethod
ListSignatures CreateSignature UpdateSignature DeleteSignature SignatureShown
ListModelServices AddModelService UpdateModelService RemoveModelService FetchModels CheckModelService TestCapability SetConversationModel
ListConversations NewConversation GetConversation DeleteConversation Ask AskWith AskAgain AssistWith AssistSkill RunSkill CancelRun ListApprovals ResolveApproval ResolveApprovalForConversation ApplyEditedProposal DraftForApproval
ListSkills SetSkillEnabled ListActions ListPlugins ListPluginRegistry RefreshPluginRegistry InstallPluginFromRegistry SetPluginEnabled UninstallPlugin GetPluginConfig SetPluginConfig PluginCards ListTranslators
ListMCPServers AddMCPServer UpdateMCPServer RemoveMCPServer SetMCPServerEnabled RefreshMCPTools GrantMCPServer SetMCPToolTrusted GrantPermission PendingMCPSends ResolveMCPSend ResolveMCPSendAcknowledged
Rules SaveRule DeleteRule SetRuleEnabled ReorderRules PreviewRule RunRuleOnExisting UndoRuleRun RuleHitCounts RuleHits
TrustedImageSenders TrustImageSender UntrustImageSender ImagesAllowed ImageCacheSize ClearImageCache AttachmentCacheUsage ClearAttachmentCache MaskingLog PreviewMasking ClearMaskingLog ListAccountLabels`

type callback struct {
	handler http.Handler
	expires time.Time
}
type Server struct {
	imagesMu     sync.Mutex
	imageAllowed map[int64]time.Time

	mcpToken   string
	mcpHandler http.Handler
	leasesMu   sync.Mutex
	leases     map[string]editorLease

	svc         *core.Service
	auth        *auth
	origin      string
	assets      http.Handler
	allowed     map[string]bool
	callbacksMu sync.Mutex
	callbacks   map[string]callback
	sendMu      sync.Mutex
}

func New(svc *core.Service, dir, origin, assets string) (*Server, error) {
	u, e := url.Parse(origin)
	if e != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("origin must be an absolute URL without a path")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1")) {
		return nil, errors.New("HTTPS required")
	}
	a, e := newAuth(dir, u.Scheme == "https")
	if e != nil {
		return nil, e
	}
	s := &Server{svc: svc, auth: a, origin: origin, assets: http.FileServer(http.Dir(assets)), allowed: map[string]bool{}, callbacks: map[string]callback{}, leases: map[string]editorLease{}, imageAllowed: map[int64]time.Time{}}
	for _, m := range strings.Fields(Methods) {
		if !reflect.ValueOf(svc).MethodByName(m).IsValid() {
			return nil, fmt.Errorf("unknown web method %s", m)
		}
		s.allowed[m] = true
	}
	return s, nil
}
func (s *Server) RegisterOAuth(authURL string, h http.Handler) {
	u, e := url.Parse(authURL)
	if e != nil {
		return
	}
	state := u.Query().Get("state")
	if state == "" {
		return
	}
	s.callbacksMu.Lock()
	defer s.callbacksMu.Unlock()
	for k, v := range s.callbacks {
		if time.Now().After(v.expires) {
			delete(s.callbacks, k)
		}
	}
	if len(s.callbacks) < 32 {
		s.callbacks[state] = callback{h, time.Now().Add(10 * time.Minute)}
	}
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
	if r.URL.Path == "/mcp" {
		if s.mcpHandler == nil || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != s.origin) || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.mcpToken)) != 1 {
			http.Error(w, "unauthorized MCP client", 401)
			return
		}
		s.mcpHandler.ServeHTTP(w, r)
		return
	}
	if r.URL.Path == "/healthz" {
		w.Write([]byte("ok"))
		return
	}
	if r.URL.Path == "/oauth/callback" && r.Method == "GET" {
		s.callbacksMu.Lock()
		c, ok := s.callbacks[r.URL.Query().Get("state")]
		if ok {
			delete(s.callbacks, r.URL.Query().Get("state"))
		}
		s.callbacksMu.Unlock()
		if !ok || time.Now().After(c.expires) {
			http.Error(w, "expired authorization", 400)
			return
		}
		c.handler.ServeHTTP(w, r)
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		if r.Header.Get("Origin") != s.origin {
			http.Error(w, "invalid origin", 403)
			return
		}
	}
	if r.URL.Path == "/api/v1/login" && r.Method == "POST" {
		w.Header().Set("Content-Type", "application/json")
		s.auth.login(w, r)
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		if r.Method != "GET" && r.Method != "HEAD" {
			http.Error(w, "method not allowed", 405)
			return
		}
		if r.URL.Path == "/" {
			r.URL.Path = "/webmail.html"
		}
		s.assets.ServeHTTP(w, r)
		return
	}
	session, ok := s.auth.lookup(r)
	if !ok {
		http.Error(w, "로그인이 필요합니다", 401)
		return
	}
	if r.Method != "GET" && r.Header.Get("X-CSRF-Token") != session.csrf {
		http.Error(w, "invalid csrf token", 403)
		return
	}
	ctx, cancel := context.WithDeadline(r.Context(), session.expires)
	defer cancel()
	r = r.WithContext(ctx)
	switch {
	case r.URL.Path == "/api/v1/session" && r.Method == "GET":
		writeJSON(w, map[string]any{"csrf": session.csrf, "capabilities": map[string]any{"nativePlatform": "server", "webPush": false, "offline": false}, "methods": strings.Fields(Methods)})
	case r.URL.Path == "/api/v1/logout" && r.Method == "POST":
		s.auth.logout(w, r)
	case r.URL.Path == "/api/v1/events" && r.Method == "GET":
		s.events(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/v1/images/") && r.Method == "POST":
		id, e := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/v1/images/"), 10, 64)
		if e != nil {
			http.Error(w, "invalid message", 400)
			return
		}
		s.allowImages(id)
		w.WriteHeader(204)
	case strings.HasPrefix(r.URL.Path, "/api/v1/body/") && r.Method == "GET":
		s.body(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/v1/attachment/") && r.Method == "GET":
		s.attachment(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/v1/editor/") && (r.Method == "POST" || r.Method == "DELETE"):
		s.editor(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/v1/upload/") && r.Method == "POST":
		s.upload(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/v1/call/") && r.Method == "POST":
		s.call(w, r, strings.TrimPrefix(r.URL.Path, "/api/v1/call/"))
	default:
		http.NotFound(w, r)
	}
}
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
func (s *Server) call(w http.ResponseWriter, r *http.Request, name string) {
	if !s.allowed[name] {
		http.Error(w, "method unavailable", 404)
		return
	}
	var params []json.RawMessage
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&params) != nil {
		http.Error(w, "invalid arguments", 400)
		return
	}
	fn := reflect.ValueOf(s.svc).MethodByName(name)
	t := fn.Type()
	args := []reflect.Value{}
	start := 0
	if t.NumIn() > 0 && t.In(0) == reflect.TypeFor[context.Context]() {
		args = append(args, reflect.ValueOf(r.Context()))
		start = 1
	}
	if len(params) != t.NumIn()-start {
		http.Error(w, "invalid argument count", 400)
		return
	}
	for i, p := range params {
		v := reflect.New(t.In(i + start))
		if json.Unmarshal(p, v.Interface()) != nil {
			http.Error(w, "invalid argument type", 400)
			return
		}
		args = append(args, v.Elem())
	}
	// A browser must always bind draft writes to the revision it read.
	if name == "SaveDraft" {
		d := args[len(args)-1].Interface().(core.Draft)
		if d.Revision <= 0 {
			http.Error(w, "draft revision required", 400)
			return
		}
	}
	if name == "SendRevision" || name == "SendAcknowledgedRevision" {
		s.sendMu.Lock()
		defer s.sendMu.Unlock()
	}
	if e := rpcbind.AuditCall(s.svc, rpc.RoleFull, name, params); e != nil {
		http.Error(w, "audit unavailable", 503)
		return
	}
	out := fn.Call(args)
	if len(out) > 0 && out[len(out)-1].Type() == reflect.TypeFor[error]() {
		e := out[len(out)-1]
		if !e.IsNil() {
			err := e.Interface().(error)
			payload := map[string]any{"error": rpcbind.Key(err)}
			var warn *core.SendWarningsError
			var block *core.SendBlockedError
			if errors.As(err, &warn) {
				payload["warnings"] = warn.Check.Warnings
				payload["digest"] = warn.Check.Digest
			}
			if errors.As(err, &block) {
				payload["blocked"] = block.Message
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(409)
			writeJSON(w, payload)
			return
		}
		out = out[:len(out)-1]
	}
	if len(out) > 0 && out[0].Kind() == reflect.Chan {
		s.stream(w, r, out[0])
		return
	}
	if len(out) == 0 {
		writeJSON(w, nil)
	} else if len(out) == 1 {
		writeJSON(w, out[0].Interface())
	} else {
		vs := []any{}
		for _, v := range out {
			vs = append(vs, v.Interface())
		}
		writeJSON(w, vs)
	}
}
func (s *Server) stream(w http.ResponseWriter, r *http.Request, ch reflect.Value) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	f, ok := w.(http.Flusher)
	if !ok {
		return
	}
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	cases := []reflect.SelectCase{{Dir: reflect.SelectRecv, Chan: ch}, {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(r.Context().Done())}, {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(tick.C)}}
	for {
		i, v, open := reflect.Select(cases)
		if i == 1 || !open {
			return
		}
		if i == 2 {
			fmt.Fprint(w, ": keepalive\n\n")
		} else {
			b, _ := json.Marshal(v.Interface())
			if _, e := fmt.Fprintf(w, "data: %s\n\n", b); e != nil {
				return
			}
		}
		f.Flush()
	}
}
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	ch, stop := s.svc.Subscribe()
	defer stop()
	s.stream(w, r, reflect.ValueOf(ch))
}
func (s *Server) body(w http.ResponseWriter, r *http.Request) {
	id, e := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/v1/body/"), 10, 64)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	body, e := s.bodyHTML(r.Context(), id, s.imagesAllowed(id))
	if e != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Del("X-Frame-Options")
	w.Header().Set("Content-Security-Policy", "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte("<!doctype html><meta name='viewport' content='width=device-width'><style>body{font:14px/1.6 system-ui;overflow-wrap:anywhere;margin:20px}img,table{max-width:100%}pre{white-space:pre-wrap}</style>" + body))
}
func (s *Server) attachment(w http.ResponseWriter, r *http.Request) {
	id, e := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/v1/attachment/"), 10, 64)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	p, info, e := s.svc.GetAttachment(r.Context(), id)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": info.Filename}))
	http.ServeFile(w, r, p)
}
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	id, e := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/v1/upload/"), 10, 64)
	rev, er := strconv.ParseInt(r.URL.Query().Get("revision"), 10, 64)
	if e != nil || er != nil || rev <= 0 {
		http.Error(w, "draft revision required", 400)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, core.MaxMessageBytes+1<<20)
	if r.ParseMultipartForm(1<<20) != nil {
		http.Error(w, "invalid upload", 400)
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, h, e := r.FormFile("file")
	if e != nil {
		http.Error(w, "file required", 400)
		return
	}
	defer f.Close()
	dir, e := os.MkdirTemp("", "godwit-upload-")
	if e != nil {
		http.Error(w, "upload failed", 500)
		return
	}
	defer os.RemoveAll(dir)
	name := filepath.Base(strings.ReplaceAll(h.Filename, "\\", "/"))
	if name == "." || name == "/" {
		http.Error(w, "invalid filename", 400)
		return
	}
	p := filepath.Join(dir, name)
	out, e := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		http.Error(w, "upload failed", 500)
		return
	}
	n, e := io.Copy(out, io.LimitReader(f, core.MaxMessageBytes+1))
	out.Close()
	if e != nil || n > core.MaxMessageBytes {
		http.Error(w, "file too large", 413)
		return
	}
	att, next, e := s.svc.AddAttachmentAt(r.Context(), id, rev, p)
	if e != nil {
		http.Error(w, "attachment changed or upload failed", 409)
		return
	}
	writeJSON(w, map[string]any{"attachment": att, "revision": next})
}

func (s *Server) SetMCP(token string, h http.Handler) { s.mcpToken = token; s.mcpHandler = h }

type editorLease struct {
	draft   int64
	expires time.Time
}

func (s *Server) DraftOpen(id int64) bool {
	s.leasesMu.Lock()
	defer s.leasesMu.Unlock()
	open := false
	for k, l := range s.leases {
		if time.Now().After(l.expires) {
			delete(s.leases, k)
		} else if l.draft == id {
			open = true
		}
	}
	return open
}
func (s *Server) editor(w http.ResponseWriter, r *http.Request) {
	id, e := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/v1/editor/"), 10, 64)
	key := r.Header.Get("X-Editor-ID")
	if e != nil || id <= 0 || len(key) < 16 || len(key) > 128 {
		http.Error(w, "invalid editor", 400)
		return
	}
	s.leasesMu.Lock()
	defer s.leasesMu.Unlock()
	if r.Method == "DELETE" {
		delete(s.leases, key)
	} else {
		s.leases[key] = editorLease{id, time.Now().Add(45 * time.Second)}
	}
	w.WriteHeader(204)
}
