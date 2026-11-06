import { StrictMode, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  RiMailLine,
  RiInboxLine,
  RiStarLine,
  RiDraftLine,
  RiSendPlaneLine,
  RiSettings3Line,
  RiSearchLine,
  RiEditLine,
  RiArrowLeftLine,
  RiArchiveLine,
  RiDeleteBinLine,
  RiRefreshLine,
  RiCloseLine,
  RiMenuLine,
  RiSparklingLine,
  RiAttachmentLine,
  RiLogoutBoxLine,
  RiContactsLine,
  RiFolderLine,
} from "@remixicon/react";
import {
  call,
  session,
  login,
  logout,
  stream,
  upload,
  APIError,
  editorLease,
  allowImages,
} from "./api";
import { makeT } from "./i18n";
import "@/shared/styles.css";
import "./tokens.css";
import "./webmail.css";
const Fields = lazy(() => import("@/compose/fields/Fields").then((m) => ({ default: m.Fields })));
import type { FieldsHandle } from "@/compose/fields/Fields";
const Editor = lazy(() => import("@/compose/editor/Editor").then((m) => ({ default: m.Editor })));
const Settings = lazy(() => import("./settings"));
const t = makeT("ko");
type Account = { ID: number; Email: string; Name: string; Status: string };
type Folder = { ID: number; AccountID: number; Name: string; Role: string; Unread: number };
type Mail = {
  ID: number;
  Subject: string;
  From: string;
  Snippet: string;
  Date: string;
  Flags: string[];
  Attachments?: { ID: number; Filename: string; Size: number }[];
  To?: string[];
  Cc?: string[];
};
type Draft = {
  ID: number;
  AccountID: number;
  Revision: number;
  Subject: string;
  To: string[];
  Cc: string[];
  Bcc: string[];
  HTML: string;
  ReplyTo?: string;
  Attachments: { ID: number; Filename: string }[];
};
const icons = {
  inbox: RiInboxLine,
  sent: RiSendPlaneLine,
  drafts: RiDraftLine,
  trash: RiDeleteBinLine,
  archive: RiArchiveLine,
};
function IconButton({
  title,
  onClick,
  children,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function App() {
  const [authenticated, auth] = useState<boolean | null>(null),
    [password, setPassword] = useState(""),
    [otp, setOTP] = useState(""),
    [error, setError] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]),
    [folders, setFolders] = useState<Folder[]>([]),
    [items, setItems] = useState<Mail[]>([]),
    [cursor, setCursor] = useState("");
  const [view, setView] = useState<any>({ Unified: "inbox" }),
    [page, setPage] = useState("mail"),
    [selected, select] = useState<Mail | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [sidebar, setSidebar] = useState(false),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0),
    [status, setStatus] = useState(""),
    [notice, setNotice] = useState("");
  const [mcpPending, setMCPPending] = useState<any[]>([]);
  const [imageVersion, setImageVersion] = useState(0);
  const [skillJob, setSkillJob] = useState<{ name: string; id: number } | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]),
    [outbox, setOutbox] = useState<any[]>([]),
    [settings, setSettings] = useState<any>(null);
  const generation = useRef(0),
    search = useRef<HTMLInputElement>(null);
  const fail = useCallback((e: any) => {
    if (e instanceof APIError && e.status === 401) auth(false);
    else setError(t(e.message || String(e)));
  }, []);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  useEffect(() => {
    session()
      .then(() => auth(true))
      .catch(() => auth(false));
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    Promise.all([
      call<Account[]>("ListAccounts"),
      call<Folder[]>("ListFolders", 0),
      call("GetSettings"),
      call<any[]>("PendingMCPSends"),
    ])
      .then(([a, f, s, pending]) => {
        setMCPPending(pending || []);
        setAccounts(a || []);
        setFolders(f || []);
        setSettings(s);
        const dark =
          s.Theme === "dark" ||
          (s.Theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.dataset.theme = dark ? "dark" : "light";
        document.documentElement.style.fontSize = `${s.FontSize || 14}px`;
      })
      .catch(fail);
  }, [authenticated, refresh, fail]);
  useEffect(() => {
    if (!authenticated) return;
    let timer: ReturnType<typeof setTimeout>;
    const es = new EventSource("/api/v1/events");
    es.onopen = () => {
      setStatus("");
      reload();
    };
    es.onerror = () => setStatus("연결 복구 중");
    es.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 250);
    };
    const focus = () => reload();
    window.addEventListener("focus", focus);
    const interval = setInterval(reload, 30000);
    return () => {
      es.close();
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [authenticated, reload]);
  useEffect(() => {
    if (!authenticated || page !== "mail") return;
    const gen = ++generation.current;
    setLoading(true);
    const timer = setTimeout(
      () => {
        let task: Promise<any>;
        if (view.Unified === "drafts")
          task = call<Draft[]>("ListDrafts", 0).then((v) => {
            if (gen === generation.current) setDrafts(v || []);
          });
        else if (view.Unified === "outbox")
          task = call("ListOutbox", 0).then((v) => {
            if (gen === generation.current) setOutbox(v || []);
          });
        else
          task = (
            query
              ? call<Mail[]>("Search", 0, query, 200).then((v) => ({ Items: v, NextCursor: "" }))
              : call("ListMessages", view, "", 100)
          ).then((v) => {
            if (gen === generation.current) {
              setItems(v.Items || []);
              setCursor(v.NextCursor || "");
            }
          });
        task.catch(fail).finally(() => {
          if (gen === generation.current) setLoading(false);
        });
      },
      query ? 200 : 0,
    );
    return () => clearTimeout(timer);
  }, [authenticated, page, view, query, refresh, fail]);
  const open = useCallback(
    async (m: Mail) => {
      select(m);
      try {
        const full = await call<Mail>("GetMessage", m.ID, false);
        select((current) => (current?.ID === m.ID ? full : current));
        if (!m.Flags?.includes("\\Seen")) {
          await call("SetFlags", [m.ID], ["\\Seen"], []);
          reload();
        }
      } catch (e) {
        fail(e);
      }
    },
    [fail, reload],
  );
  const compose = useCallback(
    async (mode = "new") => {
      try {
        const account = accounts.find((a) => a.ID === view.AccountID) || accounts[0];
        if (!account) {
          setPage("settings");
          setNotice("먼저 메일 계정을 연결해 주세요");
          return;
        }
        const d = await call<Draft>("NewDraft", account.ID, mode, selected?.ID || 0);
        setDraft(d);
      } catch (e) {
        fail(e);
      }
    },
    [accounts, view, selected, fail],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (draft) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key === "Escape") {
        select(null);
        setSidebar(false);
      }
      if (
        e.key === "c" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault();
        compose();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [compose, draft]);
  const choose = (v: any) => {
    setView(v);
    setPage("mail");
    select(null);
    setQuery("");
    setSidebar(false);
  };
  const action = async (method: string, ...p: any[]) => {
    try {
      await call(method, ...p);
      reload();
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };
  const label =
    view.Unified === "inbox"
      ? "모든 받은 편지함"
      : view.Unified === "starred"
        ? "별표 표시"
        : view.Unified === "drafts"
          ? "임시보관함"
          : view.Unified === "outbox"
            ? "보낼 편지함"
            : folders.find((f) => f.ID === view.FolderID)?.Name || "메일";
  if (authenticated === null)
    return (
      <main className="login">
        <RiMailLine size={40} />
        <p>Godwit을 여는 중…</p>
      </main>
    );
  if (!authenticated)
    return (
      <main className="login">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await login(password, otp);
              setPassword("");
              setOTP("");
              auth(true);
            } catch (e) {
              fail(e);
            }
          }}
        >
          <img src="/logo.svg" alt="" width="56" />
          <h1>Godwit</h1>
          <p>나의 메일과 Wit이 있는 곳</p>
          <label>
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <label>
            인증 앱 코드
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              onChange={(e) => setOTP(e.target.value)}
              required
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary">로그인</button>
        </form>
      </main>
    );
  return (
    <div className={`app ${selected ? "reading" : ""} ${sidebar ? "sidebar-open" : ""}`}>
      <header className="topbar">
        <IconButton title="메일함 열기" onClick={() => setSidebar(!sidebar)}>
          <RiMenuLine size={19} />
        </IconButton>
        <img src="/logo.svg" alt="" width="22" />
        <strong>Godwit</strong>
        <span className="connection" role="status">
          {status}
        </span>
        <div className="search">
          <RiSearchLine size={17} />
          <input
            ref={search}
            aria-label="메일 검색"
            placeholder="메일 검색"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage("mail");
              select(null);
            }}
          />
          <kbd>⌘ K</kbd>
        </div>
        <IconButton title="동기화" onClick={() => action("SyncNow", 0)}>
          <RiRefreshLine size={18} />
        </IconButton>
      </header>
      <nav className="rail" aria-label="주 메뉴">
        <IconButton title="메일" onClick={() => setPage("mail")}>
          <RiMailLine />
        </IconButton>
        <IconButton title="Wit" onClick={() => setPage("wit")}>
          <RiSparklingLine />
        </IconButton>
        <IconButton title="연락처" onClick={() => setPage("contacts")}>
          <RiContactsLine />
        </IconButton>
        <span className="spacer" />
        <IconButton title="설정" onClick={() => setPage("settings")}>
          <RiSettings3Line />
        </IconButton>
        <IconButton
          title="로그아웃"
          onClick={() =>
            logout()
              .then(() => {
                auth(false);
                select(null);
                setDraft(null);
              })
              .catch(fail)
          }
        >
          <RiLogoutBoxLine />
        </IconButton>
      </nav>
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="메일함 닫기"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="sidebar">
        <button className="compose-button" onClick={() => compose()}>
          <RiEditLine size={18} />
          메일 쓰기
        </button>
        <div className="nav-section">메일함</div>
        {[
          ["inbox", "모든 받은 편지함", RiInboxLine],
          ["starred", "별표 표시", RiStarLine],
          ["drafts", "임시보관함", RiDraftLine],
          ["outbox", "보낼 편지함", RiSendPlaneLine],
        ].map(([key, name, I]: any) => (
          <button
            key={key}
            className={`nav-row ${view.Unified === key && page === "mail" ? "selected" : ""}`}
            onClick={() => choose({ Unified: key })}
          >
            <I size={18} />
            <span>{name}</span>
          </button>
        ))}
        {accounts.map((a) => (
          <section key={a.ID}>
            <div className="nav-section account-name" title={a.Email}>
              <i className={`status-dot ${a.Status !== "ok" ? "warning" : ""}`} />
              {a.Name || a.Email}
            </div>
            {folders
              .filter((f) => f.AccountID === a.ID)
              .map((f) => {
                const I = icons[f.Role as keyof typeof icons] || RiFolderLine;
                return (
                  <button
                    key={f.ID}
                    className={`nav-row ${view.FolderID === f.ID ? "selected" : ""}`}
                    onClick={() => choose({ FolderID: f.ID, AccountID: a.ID })}
                  >
                    <I size={17} />
                    <span>{f.Name}</span>
                    {f.Unread > 0 && <small>{f.Unread}</small>}
                  </button>
                );
              })}
          </section>
        ))}
        <button
          className="nav-row"
          onClick={() => {
            setPage("settings");
            setSidebar(false);
          }}
        >
          <span>＋</span>계정 추가
        </button>
      </aside>
      <main className="workspace">
        {error && (
          <div className="banner error" role="alert">
            {error}
            <IconButton title="오류 닫기" onClick={() => setError("")}>
              <RiCloseLine size={16} />
            </IconButton>
          </div>
        )}
        {notice && (
          <div className="banner" role="status">
            {notice}
            <IconButton title="알림 닫기" onClick={() => setNotice("")}>
              <RiCloseLine size={16} />
            </IconButton>
          </div>
        )}
        {page === "settings" ? (
          <Suspense fallback={<div className="empty">설정을 여는 중…</div>}>
            <Settings accounts={accounts} settings={settings} onSaved={reload} onError={fail} />
          </Suspense>
        ) : page === "wit" ? (
          <Wit onError={fail} />
        ) : page === "contacts" ? (
          <Contacts onError={fail} />
        ) : (
          <>
            <section className="mail-list">
              <div className="section-head">
                <h1>{query ? "검색 결과" : label}</h1>
                <small>{loading ? "불러오는 중…" : `${items.length}개`}</small>
              </div>
              <div className="list-scroll" key={JSON.stringify(view)}>
                {view.Unified === "drafts" ? (
                  drafts.map((d) => (
                    <button
                      className="mail-row"
                      key={d.ID}
                      onClick={() => call<Draft>("GetDraft", d.ID).then(setDraft).catch(fail)}
                    >
                      <strong>{d.To?.join(", ") || "받는 사람 없음"}</strong>
                      <b>{d.Subject || "제목 없음"}</b>
                      <span>임시보관 중</span>
                    </button>
                  ))
                ) : view.Unified === "outbox" ? (
                  outbox.map((o) => (
                    <div className="outbox-row" key={o.ID}>
                      <strong>{o.Subject || "제목 없음"}</strong>
                      <p>
                        {(
                          {
                            queued: "발송 대기",
                            sending: "발송 중",
                            send_uncertain: "발송 여부 확인 필요",
                            archive_uncertain: "보낸 편지함 저장 확인 필요",
                            failed: "발송 실패",
                          } as any
                        )[o.State] || o.State}
                      </p>
                      {o.State === "queued" && (
                        <button onClick={() => action("CancelOutbox", o.ID)}>발송 취소</button>
                      )}
                      {["failed", "send_uncertain", "archive_uncertain"].includes(o.State) && (
                        <>
                          <button onClick={() => action("ResolveOutbox", o.ID, "confirm_sent")}>
                            발송됨 확인
                          </button>
                          <button
                            onClick={() => {
                              if (
                                confirm(
                                  "중복 발송될 수 있습니다. 직접 확인 후 다시 보내시겠습니까?",
                                )
                              )
                                action("ResolveOutbox", o.ID, "resend");
                            }}
                          >
                            다시 보내기
                          </button>
                        </>
                      )}
                    </div>
                  ))
                ) : (
                  <VirtualList
                    items={items}
                    selected={selected?.ID}
                    onSelect={open}
                    onStar={(m) =>
                      action(
                        "SetFlags",
                        [m.ID],
                        m.Flags?.includes("\\Flagged") ? [] : ["\\Flagged"],
                        m.Flags?.includes("\\Flagged") ? ["\\Flagged"] : [],
                      )
                    }
                  />
                )}
                {!loading &&
                  items.length === 0 &&
                  view.Unified !== "drafts" &&
                  view.Unified !== "outbox" && (
                    <div className="empty">
                      <RiInboxLine size={32} />
                      <h2>{accounts.length ? "메일이 없습니다" : "첫 메일 계정을 연결하세요"}</h2>
                      <p>
                        {accounts.length
                          ? "다른 메일함을 선택하거나 검색해 보세요."
                          : "네이버, Gmail, Outlook과 IMAP/SMTP 메일을 연결할 수 있습니다."}
                      </p>
                      {!accounts.length && (
                        <button className="primary" onClick={() => setPage("settings")}>
                          계정 연결
                        </button>
                      )}
                    </div>
                  )}
                {cursor && (
                  <button
                    className="load-more"
                    disabled={loading}
                    onClick={async () => {
                      const gen = generation.current;
                      try {
                        setLoading(true);
                        const p = await call("ListMessages", view, cursor, 100);
                        if (gen === generation.current) {
                          setItems((v) => [...v, ...(p.Items || [])]);
                          setCursor(p.NextCursor || "");
                        }
                      } catch (e) {
                        fail(e);
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    이전 메일 더 보기
                  </button>
                )}
              </div>
            </section>
            <section className="reader">
              {selected ? (
                <>
                  <div className="reader-toolbar">
                    <IconButton title="메일 목록으로" onClick={() => select(null)}>
                      <RiArrowLeftLine size={18} />
                    </IconButton>
                    <IconButton
                      title="보관"
                      onClick={() =>
                        action("MoveToRole", [selected.ID], "archive").then((ok) => {
                          if (ok) select(null);
                        })
                      }
                    >
                      <RiArchiveLine size={18} />
                    </IconButton>
                    <IconButton
                      title="삭제"
                      onClick={() =>
                        action("Delete", [selected.ID]).then((ok) => {
                          if (ok) select(null);
                        })
                      }
                    >
                      <RiDeleteBinLine size={18} />
                    </IconButton>
                    <span className="spacer" />
                    <button onClick={() => compose("reply")}>답장</button>
                    <button onClick={() => compose("reply_all")}>전체 답장</button>
                    <button onClick={() => compose("forward")}>전달</button>
                  </div>
                  <div className="reader-heading">
                    <h1>{selected.Subject || "제목 없음"}</h1>
                    <div>
                      <span className="avatar">{selected.From.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{selected.From}</strong>
                        <p>받는 사람: {selected.To?.join(", ")}</p>
                      </div>
                    </div>
                    <small>{new Date(selected.Date).toLocaleString("ko-KR")}</small>
                    <div className="ai-actions">
                      {[
                        ["summarize", "요약"],
                        ["translate", "번역"],
                      ].map(([skill, name]) => (
                        <button
                          key={skill}
                          onClick={() => {
                            setSkillJob({ name: skill, id: selected.ID });
                          }}
                        >
                          <RiSparklingLine size={14} />
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      allowImages(selected.ID)
                        .then(() => setImageVersion((v) => v + 1))
                        .catch(fail)
                    }
                  >
                    이 메일의 외부 이미지 표시
                  </button>
                  <iframe
                    className="mail-body"
                    title="메일 본문"
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    src={`/api/v1/body/${selected.ID}?v=${imageVersion}`}
                    key={selected.ID}
                  />
                  {selected.Attachments?.length ? (
                    <div className="attachments">
                      {selected.Attachments.filter((a) => !(a as any).Inline).map((a) => (
                        <a href={`/api/v1/attachment/${a.ID}`} key={a.ID}>
                          <RiAttachmentLine size={16} />
                          {a.Filename}
                          <small>{Math.ceil(a.Size / 1024)} KB</small>
                        </a>
                      ))}
                    </div>
                  ) : null}
                  <div className="reply-actions">
                    <button onClick={() => compose("reply")}>↩ 답장</button>
                    <button onClick={() => compose("forward")}>전달 →</button>
                  </div>
                </>
              ) : (
                <div className="empty reader-empty">
                  <img src="/logo.svg" width="80" alt="" />
                  <p>메일을 선택하여 읽으세요</p>
                </div>
              )}
            </section>
          </>
        )}
      </main>
      {mcpPending.length > 0 && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="MCP 발송 요청"
            className="form-modal"
          >
            <h2>외부 AI 앱의 발송 요청</h2>
            {mcpPending.map((p) => (
              <div key={p.ID}>
                <h3>{p.Draft.Subject || "제목 없음"}</h3>
                <p>보내는 사람: {p.From}</p>
                <p>받는 사람: {p.Draft.To?.join(", ")}</p>
                <p>참조: {p.Draft.Cc?.join(", ")}</p>
                <p>숨은 참조: {p.Draft.Bcc?.join(", ")}</p>
                <iframe title="발송 요청 본문" sandbox="" srcDoc={p.Draft.HTML} />
                <footer>
                  <button onClick={() => action("ResolveMCPSend", p.ID, false)}>거절</button>
                  <button className="primary" onClick={() => action("ResolveMCPSend", p.ID, true)}>
                    검토한 메일 발송
                  </button>
                </footer>
              </div>
            ))}
          </section>
        </div>
      )}
      {skillJob && <SkillResult job={skillJob} onClose={() => setSkillJob(null)} onError={fail} />}
      {draft && (
        <Compose
          key={draft.ID}
          initial={draft}
          accounts={accounts}
          onClose={() => {
            setDraft(null);
            reload();
          }}
          onError={fail}
          onNotice={setNotice}
        />
      )}
    </div>
  );
}
function VirtualList({
  items,
  selected,
  onSelect,
  onStar,
}: {
  items: Mail[];
  selected?: number;
  onSelect: (m: Mail) => void;
  onStar: (m: Mail) => void;
}) {
  const [top, setTop] = useState(0),
    [height, setHeight] = useState(600);
  const ref = useRef<HTMLDivElement>(null);
  const row = 98;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const start = Math.max(0, Math.floor(top / row) - 5),
    end = Math.min(items.length, Math.ceil((top + height) / row) + 5);
  return (
    <div className="virtual-list" ref={ref} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * row, position: "relative" }}>
        {items.slice(start, end).map((m, i) => (
          <div
            key={m.ID}
            style={{ position: "absolute", top: (start + i) * row, left: 0, right: 0, height: row }}
            className={`mail-row ${selected === m.ID ? "active" : ""} ${m.Flags?.includes("\\Seen") ? "" : "unread"}`}
          >
            <button className="mail-row-main" onClick={() => onSelect(m)}>
              <div>
                <strong>{m.From}</strong>
                <time>
                  {new Date(m.Date).toLocaleDateString("ko-KR", {
                    month: "numeric",
                    day: "numeric",
                  })}
                </time>
              </div>
              <b>{m.Subject || "제목 없음"}</b>
              <span>{m.Snippet}</span>
            </button>
            <button
              className={`star ${m.Flags?.includes("\\Flagged") ? "flagged" : ""}`}
              aria-label="별표 전환"
              onClick={() => onStar(m)}
            >
              ☆
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
function Compose({
  initial,
  accounts,
  onClose,
  onError,
  onNotice,
}: {
  initial: Draft;
  accounts: Account[];
  onClose: () => void;
  onError: (e: any) => void;
  onNotice: (s: string) => void;
}) {
  const [d, setD] = useState(initial),
    [busy, setBusy] = useState(false),
    [state, setState] = useState("저장됨"),
    [conflict, setConflict] = useState(false),
    [composing, setComposing] = useState(false),
    [extra, setExtra] = useState(false);
  const fields = useRef<FieldsHandle>(null);
  const latest = useRef(d),
    saved = useRef(d),
    queue = useRef(Promise.resolve()),
    mounted = useRef(true);
  latest.current = d;
  useEffect(() => {
    mounted.current = true;
    const key = crypto.randomUUID();
    editorLease(initial.ID, key).catch(onError);
    const timer = setInterval(() => editorLease(initial.ID, key).catch(onError), 15000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      editorLease(initial.ID, key, true).catch(() => {});
    };
  }, [initial.ID, onError]);
  const save = useCallback(() => {
    const run = async () => {
      fields.current?.commitPending();
      const next = latest.current;
      if (next === saved.current) return;
      setState("저장 중…");
      try {
        const result = await call<Draft>("SaveDraft", {
          ...next,
          Revision: latest.current.Revision,
        });
        if (mounted.current) {
          const newer = latest.current !== next;
          latest.current = { ...latest.current, Revision: result.Revision };
          saved.current = newer ? { ...next, Revision: result.Revision } : latest.current;
          setD(latest.current);
          setState(newer ? "저장할 변경 있음" : "저장됨");
        }
      } catch (e) {
        saved.current = initial;
        setConflict(true);
        setState("저장하지 못함");
        throw e;
      }
    };
    const result = queue.current.then(run);
    queue.current = result.catch(() => {});
    return result;
  }, [initial]);
  useEffect(() => {
    if (composing || conflict || d === saved.current) return;
    const timer = setTimeout(() => save().catch(onError), 800);
    return () => clearTimeout(timer);
  }, [d, composing, conflict, save, onError]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (latest.current !== saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  const update = (p: Partial<Draft>) => {
    const next = { ...latest.current, ...p };
    latest.current = next;
    setD(next);
  };
  const close = async () => {
    if (composing) return;
    setBusy(true);
    try {
      await save();
      await save();
      onClose();
    } catch (e) {
      setBusy(false);
      onError(e);
    }
  };
  return (
    <div className="modal-backdrop">
      <section role="dialog" aria-modal="true" aria-label="메일 쓰기" className="compose">
        <header>
          <h2>메일 쓰기</h2>
          <span className="spacer" />
          <small role="status">{state}</small>
          <IconButton title="초안 저장 후 닫기" onClick={close}>
            <RiCloseLine size={20} />
          </IconButton>
        </header>
        {conflict && (
          <div className="banner error">
            다른 곳에서 변경되었거나 저장하지 못했습니다. 현재 내용을 복사한 뒤 저장된 초안을 다시
            열어 주세요.
          </div>
        )}
        <Suspense fallback={<p>받는 사람 입력을 여는 중…</p>}>
          <Fields
            ref={fields}
            accounts={accounts.map((a) => ({ id: a.ID, email: a.Email }))}
            from={d.AccountID}
            onFrom={async (id) => {
              try {
                await save();
                const next = await call<Draft>(
                  "SetDraftAccount",
                  d.ID,
                  id,
                  latest.current.Revision,
                );
                saved.current = next;
                latest.current = next;
                setD(next);
              } catch (e) {
                onError(e);
              }
            }}
            to={d.To || []}
            cc={d.Cc || []}
            bcc={d.Bcc || []}
            replyTo={d.ReplyTo || ""}
            subject={d.Subject}
            frozen={busy || conflict}
            t={t}
            onChange={(e) => {
              const p: Partial<Draft> = {};
              if (e.to !== undefined) p.To = e.to;
              if (e.cc !== undefined) p.Cc = e.cc;
              if (e.bcc !== undefined) p.Bcc = e.bcc;
              if (e.replyTo !== undefined) p.ReplyTo = e.replyTo;
              if (e.subject !== undefined) p.Subject = e.subject;
              update(p);
            }}
          />
        </Suspense>
        <div className="editor-container">
          <Suspense fallback={<p>편집기를 여는 중…</p>}>
            <Editor
              initial={d.HTML || ""}
              readOnly={busy || conflict}
              placeholder="메일을 작성하세요…"
              onChange={(HTML) => update({ HTML })}
              onComposing={setComposing}
              t={t}
            />
          </Suspense>
        </div>
        <div className="draft-attachments">
          {d.Attachments?.map((a) => (
            <span key={a.ID}>
              {a.Filename}
              <button
                aria-label={`${a.Filename} 제거`}
                onClick={async () => {
                  try {
                    await save();
                    await call("RemoveAttachmentAt", d.ID, a.ID, latest.current.Revision);
                    const next = await call<Draft>("GetDraft", d.ID);
                    saved.current = next;
                    latest.current = next;
                    setD(next);
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <footer>
          <button
            className="primary"
            disabled={busy || composing || conflict}
            onClick={async () => {
              setBusy(true);
              try {
                await save();
                try {
                  await call("SendRevision", d.ID, latest.current.Revision);
                } catch (e) {
                  const details = (e as APIError).details;
                  if (
                    details?.warnings &&
                    confirm(
                      details.warnings.map((w: any) => `${w.Plugin}: ${w.Message}`).join("\n") +
                        "\n경고를 확인하고 발송할까요?",
                    )
                  )
                    await call(
                      "SendAcknowledgedRevision",
                      d.ID,
                      latest.current.Revision,
                      details.digest,
                    );
                  else throw e;
                }
                onNotice("발송 대기 중입니다. 보낼 편지함에서 10초 내 취소할 수 있습니다.");
                onClose();
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RiSendPlaneLine size={17} />
            보내기
          </button>
          <label className="file-button">
            <RiAttachmentLine size={18} />
            첨부
            <input
              type="file"
              multiple
              hidden
              onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                setBusy(true);
                try {
                  await save();
                  let rev = latest.current.Revision;
                  for (const file of files) {
                    const result = await upload(d.ID, rev, file);
                    rev = result.revision;
                  }
                  const next = await call<Draft>("GetDraft", d.ID);
                  saved.current = next;
                  latest.current = next;
                  setD(next);
                } catch (e) {
                  onError(e);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          <span className="spacer" />
          <button
            disabled={busy}
            onClick={async () => {
              if (confirm("이 초안을 삭제할까요?"))
                try {
                  await call("DeleteDraft", d.ID);
                  onClose();
                } catch (e) {
                  onError(e);
                }
            }}
          >
            <RiDeleteBinLine size={17} />
          </button>
        </footer>
      </section>
    </div>
  );
}
function Wit({ onError }: { onError: (e: any) => void }) {
  const [convs, setConvs] = useState<any[]>([]),
    [conv, setConv] = useState<any>(null),
    [input, setInput] = useState(""),
    [answer, setAnswer] = useState(""),
    [busy, setBusy] = useState(false),
    [approvals, setApprovals] = useState<any[]>([]);
  const abort = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    call("ListConversations", "ask")
      .then((v) => setConvs(v || []))
      .catch(onError);
  }, [onError]);
  useEffect(() => {
    refresh();
    return () => abort.current?.abort();
  }, [refresh]);
  const load = async (id: number) => {
    const c = await call("GetConversation", id);
    setConv(c);
    setApprovals((await call("ListApprovals", id)) || []);
  };
  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    setBusy(true);
    setAnswer("");
    try {
      let c = conv;
      if (!c) {
        c = await call("NewConversation", "ask", 0);
        setConv(c);
      }
      const text = input;
      setInput("");
      abort.current = new AbortController();
      await stream(
        "Ask",
        [c.ID, text],
        (v) => {
          if (v.Kind === "text") setAnswer((p) => p + v.Text);
          if (v.Kind === "error") onError(new Error(v.Err?.Message || "AI 요청에 실패했습니다"));
          if (v.Approvals) setApprovals(v.Approvals);
        },
        abort.current.signal,
      );
      await load(c.ID);
      setAnswer("");
      refresh();
    } catch (e) {
      if ((e as any).name !== "AbortError") onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wit-layout">
      <aside>
        <button
          className="primary"
          onClick={() => {
            setConv(null);
            setAnswer("");
            setApprovals([]);
          }}
        >
          ＋ 새 대화
        </button>
        {convs.map((c) => (
          <button key={c.ID} className="nav-row" onClick={() => load(c.ID).catch(onError)}>
            {c.Title || "새 대화"}
          </button>
        ))}
      </aside>
      <section className="wit">
        <div className="section-head">
          <h1>
            <RiSparklingLine size={20} />
            Wit
          </h1>
          <span>나의 메일과 함께 생각하는 AI</span>
        </div>
        <div className="chat-scroll">
          {!conv && (
            <div className="empty">
              <RiSparklingLine size={40} />
              <h2>무엇을 도와드릴까요?</h2>
              <p>메일을 찾고 요약하거나 답장 초안을 만들어 보세요.</p>
            </div>
          )}
          {conv?.Turns?.map((turn: any) => (
            <div className="turn" key={turn.ID}>
              <div className="question">{turn.Question}</div>
              <div className="answer">{turn.Text}</div>
              {turn.Cited?.map((cite: any, i: number) => (
                <small key={i}>{cite.Subject || cite.Citation?.Subject}</small>
              ))}
            </div>
          ))}
          {answer && <div className="answer streaming">{answer}</div>}
          {approvals
            .filter((a) => a.State === "pending")
            .map((a) => (
              <div className="approval" key={a.ID}>
                <strong>실행 승인</strong>
                <p>{a.Summary}</p>
                <p>{a.Destinations?.join(", ")}</p>
                <button
                  onClick={() =>
                    call("ResolveApproval", a.ID, false)
                      .then(() => load(conv.ID))
                      .catch(onError)
                  }
                >
                  거절
                </button>
                <button
                  className="primary"
                  onClick={() =>
                    call("ResolveApproval", a.ID, true)
                      .then(() => load(conv.ID))
                      .catch(onError)
                  }
                >
                  승인
                </button>
              </div>
            ))}
        </div>
        <form className="chat-input" onSubmit={ask}>
          <textarea
            aria-label="Wit에게 질문"
            placeholder="메일에 대해 무엇이든 물어보세요…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          {busy ? (
            <button
              type="button"
              onClick={() => {
                if (conv?.ActiveRunID) call("CancelRun", conv.ActiveRunID).catch(onError);
                abort.current?.abort();
              }}
            >
              중지
            </button>
          ) : (
            <button className="primary" disabled={!input.trim()}>
              <RiSendPlaneLine size={18} />
            </button>
          )}
        </form>
        <small className="chat-note">
          AI가 외부로 정보를 보내거나 메일을 변경하는 작업은 승인 내용을 확인하세요.
        </small>
      </section>
    </div>
  );
}
function Contacts({ onError }: { onError: (e: any) => void }) {
  const [contacts, setContacts] = useState<any[]>([]);
  useEffect(() => {
    call("Contacts")
      .then((v) => setContacts(v || []))
      .catch(onError);
  }, [onError]);
  return (
    <section className="settings-content">
      <h1>연락처</h1>
      {contacts.map((c, i) => (
        <div className="settings-row" key={c.ID || i}>
          <strong>{c.Name || c.Address}</strong>
          <span>{c.Address}</span>
        </div>
      ))}
      {!contacts.length && <div className="empty">메일에서 찾은 연락처가 여기에 표시됩니다.</div>}
    </section>
  );
}
function SkillResult({
  job,
  onClose,
  onError,
}: {
  job: { name: string; id: number };
  onClose: () => void;
  onError: (e: any) => void;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(true);
  const controller = useRef<AbortController | null>(null);
  // Starting a model request is an explicit action. Avoid StrictMode's effect replay
  // issuing the action twice: wait one task and cancel that task on cleanup.
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    const timer = setTimeout(() => {
      stream(
        "RunSkill",
        [job.name, { Kind: "message", ID: job.id }],
        (ev) => {
          if (ev.Kind === "text") setText((v) => v + ev.Text);
          if (ev.Kind === "error") onError(new Error(ev.Err?.Message || "AI 요청에 실패했습니다"));
        },
        c.signal,
      )
        .catch((e) => {
          if (e.name !== "AbortError") onError(e);
        })
        .finally(() => setBusy(false));
    }, 0);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [job.name, job.id, onError]);
  return (
    <div className="modal-backdrop">
      <section
        className="form-modal"
        role="dialog"
        aria-modal="true"
        aria-label={job.name === "translate" ? "메일 번역" : "메일 요약"}
      >
        <header>
          <h2>{job.name === "translate" ? "메일 번역" : "메일 요약"}</h2>
          <IconButton title="닫기" onClick={onClose}>
            <RiCloseLine size={20} />
          </IconButton>
        </header>
        <div className="answer">{text || "연결한 모델에 요청 중…"}</div>
        <footer>
          {busy ? (
            <button onClick={() => controller.current?.abort()}>중지</button>
          ) : (
            <button onClick={() => navigator.clipboard.writeText(text).catch(onError)}>복사</button>
          )}
        </footer>
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
