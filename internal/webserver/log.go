package webserver

import (
	"context"
	"log/slog"
)

// RedactingHandler applies credential redaction before the logger formats values.
type RedactingHandler struct {
	Handler slog.Handler
	Redact  func(string) string
}

func (h RedactingHandler) Enabled(c context.Context, l slog.Level) bool {
	return h.Handler.Enabled(c, l)
}
func (h RedactingHandler) Handle(c context.Context, r slog.Record) error {
	out := slog.NewRecord(r.Time, r.Level, h.Redact(r.Message), r.PC)
	r.Attrs(func(a slog.Attr) bool { out.AddAttrs(h.clean(a)); return true })
	return h.Handler.Handle(c, out)
}
func (h RedactingHandler) clean(a slog.Attr) slog.Attr {
	v := a.Value.Resolve()
	if v.Kind() == slog.KindGroup {
		g := v.Group()
		out := make([]slog.Attr, len(g))
		for i, x := range g {
			out[i] = h.clean(x)
		}
		v = slog.GroupValue(out...)
	} else if v.Kind() == slog.KindString || v.Kind() == slog.KindAny {
		v = slog.StringValue(h.Redact(v.String()))
	}
	return slog.Attr{Key: h.Redact(a.Key), Value: v}
}
func (h RedactingHandler) WithAttrs(as []slog.Attr) slog.Handler {
	out := make([]slog.Attr, len(as))
	for i, a := range as {
		out[i] = h.clean(a)
	}
	return RedactingHandler{h.Handler.WithAttrs(out), h.Redact}
}
func (h RedactingHandler) WithGroup(n string) slog.Handler {
	return RedactingHandler{h.Handler.WithGroup(h.Redact(n)), h.Redact}
}
