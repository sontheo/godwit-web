package webserver

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func totp(secret string, at time.Time) string {
	key, e := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if e != nil {
		return ""
	}
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], uint64(at.Unix()/30))
	h := hmac.New(sha1.New, key)
	h.Write(b[:])
	sum := h.Sum(nil)
	i := sum[len(sum)-1] & 15
	n := (binary.BigEndian.Uint32(sum[i:i+4]) & 0x7fffffff) % 1000000
	return fmt.Sprintf("%06d", n)
}
func validOTP(secret, code string, now time.Time) (int64, bool) {
	if len(code) != 6 {
		return 0, false
	}
	if _, e := strconv.Atoi(code); e != nil {
		return 0, false
	}
	for _, offset := range []int64{-1, 0, 1} {
		t := now.Add(time.Duration(offset) * 30 * time.Second)
		if subtle.ConstantTimeCompare([]byte(totp(secret, t)), []byte(code)) == 1 {
			return t.Unix() / 30, true
		}
	}
	return 0, false
}
