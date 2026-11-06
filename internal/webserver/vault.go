package webserver

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"github.com/zalando/go-keyring"
	"os"
	"path/filepath"
	"sync"
)

// Vault encrypts credentials independently of the mail database. The key must
// be mounted separately in production and backed up with restricted access.
type Vault struct {
	mu   sync.Mutex
	path string
	aead cipher.AEAD
}

func OpenVault(path, keyPath string) (*Vault, error) {
	key, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, err
	}
	if fi, e := os.Stat(keyPath); e != nil || fi.Mode().Perm()&0077 != 0 {
		return nil, errors.New("vault key must have mode 0600")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, errors.New("invalid vault key")
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Vault{path: path, aead: aead}, nil
}
func (v *Vault) read() (map[string]string, error) {
	b, err := os.ReadFile(v.path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	n := v.aead.NonceSize()
	if len(b) < n {
		return nil, errors.New("invalid vault")
	}
	plain, err := v.aead.Open(nil, b[:n], b[n:], []byte("godwit-web-vault-v1"))
	if err != nil {
		return nil, errors.New("vault authentication failed")
	}
	var m map[string]string
	err = json.Unmarshal(plain, &m)
	if m == nil && err == nil {
		err = errors.New("invalid vault contents")
	}
	return m, err
}
func (v *Vault) write(m map[string]string) error {
	plain, err := json.Marshal(m)
	if err != nil {
		return err
	}
	nonce := make([]byte, v.aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return err
	}
	b := v.aead.Seal(nonce, nonce, plain, []byte("godwit-web-vault-v1"))
	return atomicWrite(v.path, b)
}
func (v *Vault) Get(k string) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	m, e := v.read()
	if e != nil {
		return "", e
	}
	s, ok := m[k]
	if !ok {
		return "", keyring.ErrNotFound
	}
	return s, nil
}
func (v *Vault) Set(k, s string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	m, e := v.read()
	if e != nil {
		return e
	}
	m[k] = s
	return v.write(m)
}
func (v *Vault) Delete(k string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	m, e := v.read()
	if e != nil {
		return e
	}
	if _, ok := m[k]; !ok {
		return keyring.ErrNotFound
	}
	delete(m, k)
	return v.write(m)
}
func atomicWrite(path string, b []byte) error {
	f, e := os.CreateTemp(filepath.Dir(path), ".private-*")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(b); e == nil {
		e = f.Sync()
	}
	if c := f.Close(); e == nil {
		e = c
	}
	if e != nil {
		return e
	}
	return os.Rename(f.Name(), path)
}
