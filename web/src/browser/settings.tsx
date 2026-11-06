import { useEffect, useState } from "react";
import { RiArrowLeftLine, RiAddLine, RiCloseLine } from "@remixicon/react";
import { call } from "./api";
const sections = [
  ["general", "일반"],
  ["accounts", "계정"],
  ["models", "모델 서비스"],
  ["features", "AI 기능"],
  ["labels", "라벨"],
  ["rules", "규칙"],
  ["signatures", "서명"],
  ["privacy", "개인정보 보호"],
  ["extensions", "확장 프로그램"],
  ["mcp", "MCP 서버"],
];
export default function Settings({
  accounts,
  settings,
  onSaved,
  onError,
}: {
  accounts: any[];
  settings: any;
  onSaved: () => void;
  onError: (e: any) => void;
}) {
  const [tab, setTab] = useState("accounts"),
    [local, setLocal] = useState(settings),
    [data, setData] = useState<any[]>([]),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState("");
  useEffect(() => setLocal(settings), [settings]);
  const load = () => {
    const names: any = {
      models: "ListModelServices",
      labels: "ListLabels",
      rules: "Rules",
      signatures: "ListSignatures",
      extensions: "ListPlugins",
      mcp: "ListMCPServers",
    };
    if (names[tab])
      call(names[tab])
        .then((v) => setData(v || []))
        .catch(onError);
    else setData([]);
  };
  useEffect(() => {
    load();
    setAdding(false);
  }, [tab]);
  const update = async (p: any) => {
    try {
      const result = await call("SetSettings", { ...local, ...p });
      setLocal(result);
      onSaved();
      setSaved("저장됨");
      setTimeout(() => setSaved(""), 2000);
    } catch (e) {
      onError(e);
    }
  };
  const action = async (method: string, ...params: any[]) => {
    setBusy(true);
    try {
      await call(method, ...params);
      load();
      onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (key: string, name: string, help?: string) => (
    <label className="settings-row" key={key}>
      <span>
        <strong>{name}</strong>
        {help && <small>{help}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={!!local?.[key]}
        onChange={(e) => update({ [key]: e.target.checked })}
      />
    </label>
  );
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="설정 항목">
        <h1>설정</h1>
        {sections.map(([key, name]) => (
          <button
            className={`nav-row ${tab === key ? "selected" : ""}`}
            key={key}
            onClick={() => setTab(key)}
          >
            {name}
          </button>
        ))}
      </nav>
      <section className="settings-content">
        <header>
          <h1>{sections.find((s) => s[0] === tab)?.[1]}</h1>
          <small role="status">{saved}</small>
        </header>
        {tab === "general" && local && (
          <>
            <p className="muted">Godwit의 모양과 읽기 환경을 설정하세요.</p>
            <div className="settings-card">
              <label className="settings-row">
                <strong>테마</strong>
                <select
                  value={local.Theme || "system"}
                  onChange={(e) => update({ Theme: e.target.value })}
                >
                  <option value="system">시스템 설정</option>
                  <option value="light">밝게</option>
                  <option value="dark">어둡게</option>
                </select>
              </label>
              <label className="settings-row">
                <strong>화면 밀도</strong>
                <select
                  value={local.Density || "compact"}
                  onChange={(e) => update({ Density: e.target.value })}
                >
                  <option value="compact">조밀하게</option>
                  <option value="comfortable">보통</option>
                </select>
              </label>
              <label className="settings-row">
                <strong>글꼴 크기</strong>
                <input
                  type="number"
                  min="12"
                  max="24"
                  value={local.FontSize || 14}
                  onChange={(e) => update({ FontSize: Number(e.target.value) })}
                />
              </label>
              <label className="settings-row">
                <strong>본문 글꼴 크기</strong>
                <input
                  type="number"
                  min="12"
                  max="32"
                  value={local.BodyFontSize || 14}
                  onChange={(e) => update({ BodyFontSize: Number(e.target.value) })}
                />
              </label>
              {toggle("ThreadView", "메일을 대화로 묶기")}
              {toggle("ThreadCollapse", "긴 대화 접기")}
            </div>
          </>
        )}
        {tab === "accounts" && (
          <>
            <p className="muted">여러 메일 계정을 한 곳에서 확인하세요.</p>
            <div className="settings-card">
              {accounts.map((a) => (
                <div className="settings-row" key={a.ID}>
                  <span>
                    <strong>{a.Name || a.Email}</strong>
                    <small>
                      {a.Email} · {a.Status === "ok" ? "연결됨" : a.Status}
                    </small>
                  </span>
                  <button
                    onClick={() => {
                      if (confirm(`${a.Email} 연결을 해제할까요? 서버의 메일은 삭제하지 않습니다.`))
                        action("RemoveAccount", a.ID);
                    }}
                  >
                    연결 해제
                  </button>
                </div>
              ))}
            </div>
            <button className="primary" onClick={() => setAdding(true)}>
              <RiAddLine size={16} />
              계정 추가
            </button>
            {adding && (
              <AccountForm
                onClose={() => setAdding(false)}
                onError={onError}
                onSaved={() => {
                  setAdding(false);
                  onSaved();
                }}
              />
            )}
          </>
        )}
        {tab === "models" && (
          <>
            <p className="muted">나의 API 키 또는 호환 서버로 Wit을 사용하세요.</p>
            {data.map((m) => (
              <div className="settings-card" key={m.ID}>
                <div className="settings-row">
                  <span>
                    <strong>{m.Name}</strong>
                    <small>{m.BaseURL}</small>
                  </span>
                  <button
                    onClick={() => {
                      if (confirm("이 모델 서비스를 삭제할까요?"))
                        action("RemoveModelService", m.ID);
                    }}
                  >
                    삭제
                  </button>
                </div>
                {m.Models?.map((id: string) => (
                  <label className="settings-row" key={id}>
                    <span>{id}</span>
                    <button onClick={() => update({ DefaultModel: `${m.Slug}/${id}` })}>
                      {local?.DefaultModel === `${m.Slug}/${id}` ? "기본 모델" : "기본으로 사용"}
                    </button>
                  </label>
                ))}
              </div>
            ))}
            <button className="primary" onClick={() => setAdding(true)}>
              모델 서비스 추가
            </button>
            {adding && (
              <ModelForm
                onClose={() => setAdding(false)}
                onError={onError}
                onSaved={() => {
                  setAdding(false);
                  load();
                }}
              />
            )}
          </>
        )}
        {tab === "features" && local && (
          <>
            <p className="muted">
              AI 기능은 연결한 모델을 사용합니다. 모델 서비스의 사용료가 적용될 수 있습니다.
            </p>
            <div className="settings-card">
              {toggle("Summary", "메일 요약")}
              {toggle("QuickReplies", "빠른 답장")}
              {toggle("SecurityAI", "AI 보안 검사")}
              {toggle("Masking", "외부 AI로 보내기 전 개인정보 마스킹")}
              <label className="settings-row">
                <span>
                  <strong>외부 AI 앱을 통한 발송</strong>
                  <small>
                    직접 발송을 허용하면 외부 AI 앱이 승인 없이 메일을 보낼 수 있습니다.
                  </small>
                </span>
                <select
                  value={local.MCPSend || "confirm"}
                  onChange={(e) => update({ MCPSend: e.target.value })}
                >
                  <option value="off">허용 안 함</option>
                  <option value="confirm">매번 확인</option>
                  <option value="direct">직접 발송 허용</option>
                </select>
              </label>
              <label className="settings-row">
                <strong>읽기·번역 언어</strong>
                <select
                  value={local.ReadingLanguage || "ko"}
                  onChange={(e) => update({ ReadingLanguage: e.target.value })}
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="zh-Hans">简体中文</option>
                </select>
              </label>
              <label className="settings-row">
                <strong>답장 언어</strong>
                <select
                  value={local.ReplyLanguage || "match"}
                  onChange={(e) => update({ ReplyLanguage: e.target.value })}
                >
                  <option value="match">받은 메일 언어에 맞추기</option>
                  <option value="reading">읽기 언어</option>
                </select>
              </label>
            </div>
          </>
        )}
        {tab === "privacy" && local && (
          <>
            <p className="muted">메일 내용과 외부 연결을 관리하세요.</p>
            <div className="settings-card">
              {toggle("Masking", "AI 요청 개인정보 마스킹")}
              {toggle("SecurityWarnings", "보안 경고 표시")}
              {toggle("VerifiedBadge", "인증된 발신자 표시")}
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <strong>첨부파일 캐시</strong>
                <button onClick={() => action("ClearAttachmentCache")}>비우기</button>
              </div>
              <div className="settings-row">
                <strong>이미지 캐시</strong>
                <button onClick={() => action("ClearImageCache")}>비우기</button>
              </div>
            </div>
          </>
        )}
        {tab === "labels" && (
          <>
            <p className="muted">메일을 분류할 라벨을 관리하세요.</p>
            <div className="settings-card">
              {data.map((l) => (
                <div className="settings-row" key={l.ID}>
                  <span>
                    <strong>{l.Name}</strong>
                    <small>{l.Description}</small>
                  </span>
                  <button
                    onClick={() => {
                      if (confirm("이 라벨을 삭제할까요?")) action("DeleteLabel", l.ID);
                    }}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <LabelForm onSave={(input) => action("CreateLabel", input)} />
          </>
        )}
        {tab === "rules" && (
          <>
            <p className="muted">새 메일을 조건에 따라 정리하세요.</p>
            <div className="settings-card">
              {data.map((r) => (
                <div className="settings-row" key={r.ID}>
                  <span>
                    <strong>{r.Doc.name}</strong>
                    <small>{r.Doc.conditions?.map((c: any) => c.value).join(", ")}</small>
                  </span>
                  <input
                    aria-label={`${r.Doc.name} 활성화`}
                    type="checkbox"
                    checked={r.Enabled}
                    onChange={(e) => action("SetRuleEnabled", r.ID, e.target.checked)}
                  />
                  <button
                    onClick={() => {
                      if (confirm("이 규칙을 삭제할까요?")) action("DeleteRule", r.ID);
                    }}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <RuleForm onSave={(r) => action("SaveRule", r)} />
          </>
        )}
        {tab === "signatures" && (
          <>
            <p className="muted">메일에 사용할 서명을 관리하세요.</p>
            {data.map((s) => (
              <Signature
                key={s.ID}
                value={s}
                onSave={(p) => action("UpdateSignature", s.ID, p)}
                onDelete={() => action("DeleteSignature", s.ID)}
              />
            ))}
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                action("CreateSignature", form.get("name"));
              }}
            >
              <label>
                서명 이름
                <input name="name" required />
              </label>
              <button className="primary">새 서명</button>
            </form>
          </>
        )}
        {tab === "extensions" && (
          <>
            <p className="muted">
              서버에서 실행되는 확장 프로그램입니다. 서버 OS와 CPU에 호환되는 플러그인을 사용할 수
              있습니다.
            </p>
            <div className="settings-card">
              {data.map((p) => (
                <div className="settings-row" key={p.Name}>
                  <span>
                    <strong>{p.DisplayName || p.Name}</strong>
                    <small>{p.Description}</small>
                  </span>
                  <input
                    aria-label={`${p.Name} 활성화`}
                    type="checkbox"
                    checked={p.Enabled}
                    onChange={(e) => action("SetPluginEnabled", p.Name, e.target.checked)}
                  />
                  <button
                    onClick={() => {
                      if (confirm("이 플러그인의 권한을 허용할까요?"))
                        action("GrantPermission", p.Name);
                    }}
                  >
                    권한 확인
                  </button>
                </div>
              ))}
            </div>
            {!data.length && <p>설치된 확장 프로그램이 없습니다.</p>}
          </>
        )}
        {tab === "mcp" && (
          <>
            <p className="muted">
              Wit에 외부 도구를 연결하세요. 서버로 전송되는 정보를 확인하고 승인하세요.
            </p>
            <div className="settings-card">
              {data.map((m) => (
                <div className="settings-row" key={m.ID}>
                  <span>
                    <strong>{m.Name}</strong>
                    <small>{m.URL || m.Command}</small>
                  </span>
                  <input
                    aria-label={`${m.Name} 활성화`}
                    type="checkbox"
                    checked={m.Enabled}
                    onChange={(e) => action("SetMCPServerEnabled", m.ID, e.target.checked)}
                  />
                  <button
                    onClick={() => {
                      if (confirm(`${m.Name} 연결 권한을 허용할까요?`))
                        action("GrantMCPServer", m.ID);
                    }}
                  >
                    연결 승인
                  </button>
                  <button onClick={() => action("RemoveMCPServer", m.ID)}>삭제</button>
                </div>
              ))}
            </div>
            <MCPForm onSave={(m) => action("AddMCPServer", m)} />
          </>
        )}
        {busy && <p role="status">처리 중…</p>}
      </section>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="form-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button aria-label="닫기" onClick={onClose}>
            <RiCloseLine size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function AccountForm({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: () => void;
  onError: (e: any) => void;
}) {
  const [input, setInput] = useState<any>({
      Email: "",
      Name: "",
      Password: "",
      IMAPHost: "",
      IMAPPort: 993,
      IMAPSecurity: "tls",
      SMTPHost: "",
      SMTPPort: 465,
      SMTPSecurity: "tls",
    }),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [provider, setProvider] = useState<any>(null);
  const update = (key: string, value: any) => setInput((v: any) => ({ ...v, [key]: value }));
  const detect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const [p] = await call("DetectProvider", input.Email);
      setProvider(p);
      setInput((v: any) => ({
        ...v,
        Provider: p.ID,
        IMAPHost: p.IMAP.Host,
        IMAPPort: p.IMAP.Port,
        IMAPSecurity: p.IMAP.Security,
        SMTPHost: p.SMTP.Host,
        SMTPPort: p.SMTP.Port,
        SMTPSecurity: p.SMTP.Security,
      }));
      setStep(1);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const oauth = async () => {
    const win = window.open("about:blank", "godwit-oauth");
    setBusy(true);
    try {
      const [id, url] = await call("BeginOAuth", provider.ID, input.Email, {});
      if (win) win.location = url;
      else location.assign(url);
      const email = await call("AwaitOAuth", id);
      update("OAuthFlowID", id);
      update("Email", email);
      if (win) win.close();
    } catch (e) {
      if (win) win.close();
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="메일 계정 연결" onClose={onClose}>
      <form
        onSubmit={
          step === 0
            ? detect
            : async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await call("TestAccount", input);
                  await call("AddAccount", input);
                  setInput({});
                  onSaved();
                } catch (e) {
                  onError(e);
                } finally {
                  setBusy(false);
                }
              }
        }
      >
        <p>메일 서버와 연결하여 받은 편지함을 동기화합니다.</p>
        <label>
          이메일 주소
          <input
            type="email"
            autoComplete="email"
            value={input.Email || ""}
            onChange={(e) => update("Email", e.target.value)}
            required
            readOnly={step === 1}
          />
        </label>
        {step === 1 && (
          <>
            <label>
              표시 이름
              <input value={input.Name || ""} onChange={(e) => update("Name", e.target.value)} />
            </label>
            {provider?.OAuth && (
              <button type="button" onClick={oauth} disabled={busy}>
                {input.OAuthFlowID ? "로그인 완료" : `${provider.Name}으로 로그인`}
              </button>
            )}
            {!input.OAuthFlowID && (
              <label>
                앱 비밀번호 또는 메일 비밀번호
                <input
                  type="password"
                  autoComplete="off"
                  value={input.Password || ""}
                  onChange={(e) => update("Password", e.target.value)}
                  required
                />
              </label>
            )}
            <p className="muted">
              네이버·Gmail 등은 메일 설정에서 IMAP 사용과 앱 비밀번호가 필요할 수 있습니다.
            </p>
            <details>
              <summary>서버 설정</summary>
              <label>
                로그인 사용자 이름
                <input
                  value={input.Username || ""}
                  placeholder={input.Email}
                  onChange={(e) => update("Username", e.target.value)}
                />
              </label>
              {["IMAP", "SMTP"].map((protocol) => (
                <fieldset key={protocol}>
                  <legend>{protocol}</legend>
                  <label>
                    서버
                    <input
                      value={input[protocol + "Host"]}
                      onChange={(e) => update(protocol + "Host", e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    포트
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={input[protocol + "Port"]}
                      onChange={(e) => update(protocol + "Port", Number(e.target.value))}
                    />
                  </label>
                  <label>
                    연결 보안
                    <select
                      value={input[protocol + "Security"]}
                      onChange={(e) => update(protocol + "Security", e.target.value)}
                    >
                      <option value="tls">SSL/TLS</option>
                      <option value="starttls">STARTTLS</option>
                    </select>
                  </label>
                </fieldset>
              ))}
            </details>
          </>
        )}
        <footer>
          {step === 1 && (
            <button type="button" onClick={() => setStep(0)}>
              <RiArrowLeftLine size={16} />
              이전
            </button>
          )}
          <span className="spacer" />
          <button className="primary" disabled={busy}>
            {busy ? "연결 확인 중…" : step === 0 ? "계속" : "연결 확인 후 추가"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function ModelForm({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: () => void;
  onError: (e: any) => void;
}) {
  const [input, setInput] = useState({
      Name: "",
      Provider: "other",
      Kind: "openai",
      BaseURL: "",
      APIKey: "",
      KeyAction: "replace",
      Models: [] as string[],
    }),
    [models, setModels] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="모델 서비스 추가" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await call("AddModelService", {
              ...input,
              Models: models
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
              KeyAction: input.APIKey ? "replace" : "clear",
            });
            setInput({ ...input, APIKey: "" });
            onSaved();
          } catch (e) {
            onError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          이름
          <input
            required
            value={input.Name}
            onChange={(e) => setInput({ ...input, Name: e.target.value })}
          />
        </label>
        <label>
          API 형식
          <select value={input.Kind} onChange={(e) => setInput({ ...input, Kind: e.target.value })}>
            <option value="openai">OpenAI Chat Completions</option>
            <option value="responses">OpenAI Responses</option>
            <option value="anthropic">Anthropic Messages</option>
          </select>
        </label>
        <label>
          API 주소
          <input
            type="url"
            placeholder="https://api.example.com/v1"
            required
            value={input.BaseURL}
            onChange={(e) => setInput({ ...input, BaseURL: e.target.value })}
          />
        </label>
        <label>
          API 키
          <input
            type="password"
            autoComplete="off"
            value={input.APIKey}
            onChange={(e) => setInput({ ...input, APIKey: e.target.value })}
          />
        </label>
        <label>
          모델 ID
          <input
            required
            placeholder="여러 모델은 쉼표로 구분"
            value={models}
            onChange={(e) => setModels(e.target.value)}
          />
        </label>
        <footer>
          <button className="primary" disabled={busy}>
            {busy ? "저장 중…" : "추가"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function LabelForm({ onSave }: { onSave: (v: any) => void }) {
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({
          Name: f.get("name"),
          Description: f.get("description"),
          Color: "blue",
          Icon: "bill",
        });
        e.currentTarget.reset();
      }}
    >
      <label>
        이름
        <input name="name" required />
      </label>
      <label>
        설명
        <input name="description" />
      </label>
      <button className="primary">라벨 추가</button>
    </form>
  );
}
function RuleForm({ onSave }: { onSave: (v: any) => void }) {
  return (
    <form
      className="settings-card form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({
          Enabled: true,
          Background: true,
          Doc: {
            version: 1,
            name: f.get("name"),
            trigger: "receive",
            match: "all",
            conditions: [{ field: f.get("field"), op: "contains", value: f.get("value") }],
            actions: [{ kind: f.get("action") }],
          },
        });
      }}
    >
      <h2>새 규칙</h2>
      <label>
        이름
        <input name="name" required />
      </label>
      <label>
        조건
        <select name="field">
          <option value="from">보낸 사람</option>
          <option value="subject">제목</option>
          <option value="to">받는 사람</option>
        </select>
      </label>
      <label>
        포함하는 내용
        <input name="value" required />
      </label>
      <label>
        할 일
        <select name="action">
          <option value="read">읽음으로 표시</option>
          <option value="archive">보관</option>
          <option value="star">별표 표시</option>
        </select>
      </label>
      <button className="primary">규칙 추가</button>
    </form>
  );
}
function Signature({
  value,
  onSave,
  onDelete,
}: {
  value: any;
  onSave: (v: any) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(value.HTML || "");
  return (
    <div className="settings-card form-grid">
      <h2>{value.Name}</h2>
      <label>
        서명 내용
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div>
        <button className="primary" onClick={() => onSave({ HTML: text })}>
          저장
        </button>
        <button
          onClick={() => {
            if (confirm("서명을 삭제할까요?")) onDelete();
          }}
        >
          삭제
        </button>
      </div>
    </div>
  );
}
function MCPForm({ onSave }: { onSave: (v: any) => void }) {
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({ Name: f.get("name"), URL: f.get("url"), Transport: "http" });
        e.currentTarget.reset();
      }}
    >
      <label>
        이름
        <input name="name" required />
      </label>
      <label>
        MCP 서버 주소
        <input name="url" type="url" required />
      </label>
      <button className="primary">연결 추가</button>
    </form>
  );
}
