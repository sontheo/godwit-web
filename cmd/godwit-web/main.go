package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"github.com/godwit-email/godwit/core"
	"github.com/godwit-email/godwit/core/auth"
	"github.com/godwit-email/godwit/core/plugins"
	"github.com/godwit-email/godwit/internal/i18n"
	"github.com/godwit-email/godwit/internal/webserver"
	"github.com/godwit-email/godwit/mcpserver"
	"github.com/godwit-email/godwit/ownerlock"
	"github.com/godwit-email/godwit/rpc"
	"github.com/godwit-email/godwit/rpcbind"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "plugin-host" {
		os.Exit(plugins.ServeNative(os.Args[2:], os.Stdin, os.Stdout, os.Stderr))
	}
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	dir := flag.String("data-dir", "./web-data", "private data directory")
	key := flag.String("key-file", "", "vault key file, default DATA/vault.key")
	addr := flag.String("listen", "127.0.0.1:8787", "HTTP listen address")
	origin := flag.String("origin", "http://127.0.0.1:8787", "public origin, HTTPS outside localhost")
	assets := flag.String("assets", "web/dist-web", "built web assets")
	clients := flag.String("oauth-clients", "", "private JSON provider -> {ID,Secret} web clients")
	init := flag.Bool("init", false, "initialize credentials and exit; never prints secrets")
	flag.Parse()
	if *key == "" {
		*key = filepath.Join(*dir, "vault.key")
	}
	if *init {
		if e := webserver.Initialize(*dir, *key); e != nil {
			return e
		}
		fmt.Println("Initialized. Read the private initial-password file in the data directory; keep vault.key separate in production.")
		return nil
	}
	release, e := ownerlock.Acquire(*dir)
	if e != nil {
		return e
	}
	defer release()
	vault, e := webserver.OpenVault(filepath.Join(*dir, "credentials.enc"), *key)
	if e != nil {
		return fmt.Errorf("open vault: %w", e)
	}
	type client struct{ ID, Secret string }
	clientMap := map[string]client{}
	if *clients != "" {
		b, e := os.ReadFile(*clients)
		if e != nil {
			return e
		}
		if e = json.Unmarshal(b, &clientMap); e != nil {
			return errors.New("invalid oauth client configuration")
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	i18n.SetLanguage("ko")
	var handler *webserver.Server
	svc, e := core.New(ctx, core.Options{DataDir: *dir, AutoSync: true, LabelMail: true, SecurityMail: true, SystemLanguage: "ko", CredentialStore: vault, Registry: core.DefaultRegistry, ConfirmWindow: true,
		ComposeOpen: func(id int64) bool {
			if handler == nil {
				return true
			}
			return handler.DraftOpen(id)
		},
		OAuthConfig: func(provider string, cfg auth.OAuthConfig) (auth.OAuthConfig, error) {
			c, ok := clientMap[provider]
			if !ok || c.ID == "" {
				return cfg, errors.New("register a web OAuth client for this provider")
			}
			cfg.ClientID = c.ID
			cfg.ClientSecret = c.Secret
			cfg.Public = nil
			cfg.RedirectURL = *origin + "/oauth/callback"
			return cfg, nil
		},
		OAuthFlowStarted: func(u string, h http.Handler) {
			if handler != nil {
				handler.RegisterOAuth(u, h)
			}
		},
	})
	if e != nil {
		return fmt.Errorf("start mail service: %w", e)
	}
	defer svc.Close()
	slog.SetDefault(slog.New(webserver.RedactingHandler{Handler: slog.NewTextHandler(os.Stderr, nil), Redact: svc.Redact}))
	handler, e = webserver.New(svc, *dir, *origin, *assets)
	if e != nil {
		return e
	}
	local, e := rpcbind.Listen(*dir, svc, "web-dev")
	if e != nil {
		return e
	}
	defer local.Close()
	go local.Serve(ctx)
	mcpClient, e := rpc.Dial(*dir, rpc.RoleMCP, "godwit-web-mcp", rpcbind.NewCodec())
	if e != nil {
		return e
	}
	defer mcpClient.Close()
	token, e := os.ReadFile(filepath.Join(*dir, "mcp-token"))
	if e != nil {
		return e
	}
	mcpSvc := mcpserver.New(mcpClient, "web-dev")
	handler.SetMCP(string(token), mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return mcpSvc }, nil))
	srv := &http.Server{Addr: *addr, Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(c)
	}()
	log.Printf("Godwit Web listening on %s", *addr)
	if e = srv.ListenAndServe(); e != nil && !errors.Is(e, http.ErrServerClosed) {
		return e
	}
	return nil
}
