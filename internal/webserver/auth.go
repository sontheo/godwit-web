package webserver

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/json"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type session struct {
	expires time.Time
	csrf    string
}
type auth struct {
	otpSecret   string
	lastOTPStep int64

	mu           sync.Mutex
	hash         []byte
	sessions     map[[32]byte]session
	failures     int
	blockedUntil time.Time
	secure       bool
}

func randomToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// Initialize creates credentials once, never replacing an existing installation.
func Initialize(dir, keyPath string) error {
	if e := os.MkdirAll(dir, 0700); e != nil {
		return e
	}
	if _, e := os.Stat(filepath.Join(dir, "password.hash")); !os.IsNotExist(e) {
		return os.ErrExist
	}
	key := make([]byte, 32)
	rand.Read(key)
	f, e := os.OpenFile(keyPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	_, e = f.Write(key)
	f.Close()
	if e != nil {
		return e
	}
	otp := make([]byte, 20)
	rand.Read(otp)
	otpSecret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(otp)
	if e = atomicWrite(filepath.Join(dir, "totp.key"), []byte(otpSecret)); e != nil {
		return e
	}
	if e = atomicWrite(filepath.Join(dir, "totp-setup-uri"), []byte("otpauth://totp/Godwit:owner?secret="+otpSecret+"&issuer=Godwit&algorithm=SHA1&digits=6&period=30\n")); e != nil {
		return e
	}
	if e = atomicWrite(filepath.Join(dir, "mcp-token"), []byte(randomToken())); e != nil {
		return e
	}
	password := randomToken()
	hash, e := bcrypt.GenerateFromPassword([]byte(password), 12)
	if e != nil {
		return e
	}
	if e = atomicWrite(filepath.Join(dir, "initial-password"), []byte(password+"\n")); e != nil {
		return e
	}
	return atomicWrite(filepath.Join(dir, "password.hash"), hash)
}
func newAuth(dir string, secure bool) (*auth, error) {
	b, e := os.ReadFile(filepath.Join(dir, "password.hash"))
	if e != nil {
		return nil, e
	}
	if _, e = bcrypt.Cost(b); e != nil {
		return nil, e
	}
	otp, e := os.ReadFile(filepath.Join(dir, "totp.key"))
	if e != nil {
		return nil, e
	}
	return &auth{otpSecret: strings.TrimSpace(string(otp)), hash: b, sessions: map[[32]byte]session{}, secure: secure}, nil
}
func (a *auth) lookup(r *http.Request) (session, bool) {
	c, e := r.Cookie("godwit_session")
	if e != nil {
		return session{}, false
	}
	k := sha256.Sum256([]byte(c.Value))
	a.mu.Lock()
	defer a.mu.Unlock()
	s, ok := a.sessions[k]
	if time.Now().After(s.expires) {
		delete(a.sessions, k)
		return session{}, false
	}
	return s, ok
}
func (a *auth) login(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	blocked := time.Now().Before(a.blockedUntil)
	a.mu.Unlock()
	if blocked {
		http.Error(w, "잠시 후 다시 시도해 주세요", 429)
		return
	}
	var in struct {
		Password string
		OTP      string
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in) != nil {
		http.Error(w, "invalid request", 400)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	step, otpOK := validOTP(a.otpSecret, in.OTP, time.Now())
	if bcrypt.CompareHashAndPassword(a.hash, []byte(in.Password)) != nil || !otpOK || step <= a.lastOTPStep {
		a.failures++
		if a.failures >= 5 {
			a.blockedUntil = time.Now().Add(time.Minute)
		}
		http.Error(w, "로그인 정보를 확인해 주세요", 401)
		return
	}
	a.lastOTPStep = step
	a.failures = 0
	token := randomToken()
	s := session{time.Now().Add(12 * time.Hour), randomToken()}
	for k, v := range a.sessions {
		if time.Now().After(v.expires) {
			delete(a.sessions, k)
		}
	}
	if len(a.sessions) >= 32 {
		http.Error(w, "too many sessions", 429)
		return
	}
	a.sessions[sha256.Sum256([]byte(token))] = s
	http.SetCookie(w, &http.Cookie{Name: "godwit_session", Value: token, Path: "/", Secure: a.secure, HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 43200})
	json.NewEncoder(w).Encode(map[string]any{"csrf": s.csrf})
}
func (a *auth) logout(w http.ResponseWriter, r *http.Request) {
	if c, e := r.Cookie("godwit_session"); e == nil {
		a.mu.Lock()
		delete(a.sessions, sha256.Sum256([]byte(c.Value)))
		a.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "godwit_session", Path: "/", MaxAge: -1, HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteStrictMode})
	w.WriteHeader(204)
}
