package webserver

import (
	"bytes"
	"context"
	"encoding/base64"
	xhtml "golang.org/x/net/html"
	"html"
	"strings"
	"time"
)

// bodyHTML keeps remote fetches on the server's existing public-host-only
// image client. A per-message count and pixel budget bounds decoding/rendering.
func (s *Server) bodyHTML(ctx context.Context, id int64, allowed bool) (string, error) {
	m, e := s.svc.GetMessage(ctx, id, allowed)
	if e != nil {
		return "", e
	}
	if m.HTML == "" {
		return "<pre>" + html.EscapeString(m.Text) + "</pre>", nil
	}
	doc, e := xhtml.Parse(strings.NewReader(m.HTML))
	if e != nil {
		return "", e
	}
	count := 0
	pixels := int64(0)
	var walk func(*xhtml.Node)
	walk = func(n *xhtml.Node) {
		if n.Type == xhtml.ElementNode {
			for i := range n.Attr {
				a := &n.Attr[i]
				if n.Data == "a" && a.Key == "href" {
					n.Attr = append(n.Attr, xhtml.Attribute{Key: "target", Val: "_blank"}, xhtml.Attribute{Key: "rel", Val: "noopener noreferrer"})
				}
				if n.Data == "img" && a.Key == "src" && (strings.HasPrefix(a.Val, "https://") || strings.HasPrefix(a.Val, "http://")) {
					src := a.Val
					a.Val = ""
					if !allowed || count >= 30 {
						continue
					}
					count++
					img, e := s.svc.ImageCache().Get(ctx, src)
					if e != nil {
						continue
					}
					pixels += int64(img.Width) * int64(img.Height)
					if pixels > 80_000_000 {
						continue
					}
					a.Val = "data:image/" + img.Format + ";base64," + base64.StdEncoding.EncodeToString(img.Data)
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	var out bytes.Buffer
	if e = xhtml.Render(&out, doc); e != nil {
		return "", e
	}
	return out.String(), nil
}
func (s *Server) allowImages(id int64) {
	s.imagesMu.Lock()
	defer s.imagesMu.Unlock()
	for k, t := range s.imageAllowed {
		if time.Now().After(t) {
			delete(s.imageAllowed, k)
		}
	}
	s.imageAllowed[id] = time.Now().Add(time.Hour)
}
func (s *Server) imagesAllowed(id int64) bool {
	s.imagesMu.Lock()
	defer s.imagesMu.Unlock()
	return time.Now().Before(s.imageAllowed[id])
}
