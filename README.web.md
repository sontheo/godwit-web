# Godwit Web 개발판

Godwit `f8234f5a4cd7f74ede4e60e0407484d6674d47c7`의 메일 엔진을 사용하는 개인용 웹메일입니다. 원본의 Apache-2.0 LICENSE와 NOTICE를 유지합니다. [English](README.web.en.md)

**현재 전체 마이그레이션이 완료된 버전은 아닙니다.** 서버 인증·메일 API와 주요 화면을 구현한 개발판입니다. 기능별 상태는 [웹 마이그레이션 현황](docs/web-migration.md)을 확인하세요. 실제 메일 계정과 AI 자격정보는 아직 연결하지 않았습니다.

## 빠른 실행

Docker Compose가 설치된 Linux ARM64 또는 AMD64 서버에서:

```bash
docker compose -f compose.web.yaml build
docker compose -f compose.web.yaml run --rm mail -init -data-dir /data -key-file /keys/vault.key
docker compose -f compose.web.yaml up -d
```

`http://127.0.0.1:8878`에 접속합니다. 컨테이너는 비특권 사용자로 동작하며 호스트에는 루프백 포트만 공개합니다.

초기화는 비밀번호, TOTP 키·설정 URI, MCP 전용 토큰을 데이터 볼륨에 생성합니다. 모든 파일은 0600이며 값을 로그에 출력하지 않습니다. `initial-password`와 `totp-setup-uri`를 개인 터미널에서 확인해 인증 앱을 등록한 후 비밀번호와 6자리 코드를 입력합니다. 파일 내용을 채팅·Git·로그에 붙여넣지 마세요. 초기화는 기존 설치를 덮어쓰지 않습니다.

외부 접속은 리버스 프록시에서 HTTPS를 종료하고 `GODWIT_ORIGIN=https://메일용도메인`을 설정한 후 컨테이너를 다시 생성합니다. 프록시는 SSE 버퍼링을 끄고 장시간 연결을 허용해야 합니다. 이메일 본문·첨부파일·인증 API는 캐시하지 않습니다. 도메인과 OAuth 앱 등록 정보가 정해지기 전에는 공개 배포가 끝난 것으로 보지 않습니다.

## 메일·AI 연결

- 설정 → 계정에서 주소를 입력하면 원본의 자동 감지를 사용합니다. 필요하면 IMAP/SMTP 서버·포트·TLS 설정을 수정합니다. 네이버는 IMAP 사용 설정과 앱 비밀번호가 필요합니다.
- Google·Microsoft OAuth는 **자신이 등록한 웹 앱**과 HTTPS 콜백을 사용합니다. `-oauth-clients /비공개/clients.json`으로 공급자별 `ID`와 `Secret`을 전달합니다. 키는 `gmail`, `outlook` 등 원본 제공자 ID이며 등록할 리디렉션 주소는 `GODWIT_ORIGIN/oauth/callback`입니다. 파일을 저장소나 이미지에 넣지 마세요. 회사 Microsoft 365는 조직 정책과 원본의 개인 Outlook 제공자 구분을 추가 검증해야 합니다.
- 설정 → 모델 서비스에서 API 형식, 주소, 키, 모델 ID를 등록한 뒤 기본 모델을 선택합니다. 로컬 모델 주소는 브라우저가 아니라 **Go 서버/컨테이너에서 접근 가능한 주소**여야 합니다.
- MCP 외부 클라이언트는 `/mcp`의 Streamable HTTP와 전용 Bearer 토큰을 사용합니다. 로그인 쿠키나 관리자 비밀번호를 공유하지 않습니다. 클라이언트별 연결 호환성은 별도 검증이 필요하며 OAuth 자동 발견은 아직 없습니다.
- MCP 발송 기본값은 매번 확인입니다. 웹 화면에서 수신자·본문을 검토해야 발송하며, 직접 발송 모드에서도 작성 중인 초안은 임시 편집 잠금으로 보호합니다.

## 개발·검증

Go 1.27.3, Bun 1.4.2, Node 22 이상을 사용합니다. 기존 UI 바인딩은 원본 도구로 생성하며 직접 수정하지 않습니다.

```bash
cd web
bun install --frozen-lockfile
cd ..
go tool mygo generate
go run ./cmd/godwit-web-types
cd web
bun run browser:build
node node_modules/vitest/vitest.mjs run --maxWorkers=2
cd ..
go test ./core/... ./rpc/... ./rpcbind/... ./internal/webserver ./cmd/godwit-web ./cmd/godwit-web-types
go build -o dist/godwit-web ./cmd/godwit-web
```

Bun으로 실행한 Vitest는 현재 jsdom EventTarget 오류가 발생하므로 Node로 실행합니다. Go 테스트는 비특권 사용자, 쓰기 가능한 `XDG_CACHE_HOME`, 자식 프로세스를 회수하는 init이 있는 환경에서 실행해야 합니다. root는 파일 권한 실패 시나리오를 재현하지 못합니다.

빌드한 바이너리를 직접 실행할 때도 먼저 `-init`을 실행하고 `-data-dir`, `-key-file`, `-origin`, `-listen`, `-assets`를 지정합니다. 컨테이너 빌드는 SQLite 네이티브 라이브러리를 이미지에 포함합니다.

## 보관·복구

메일 DB·첨부파일은 `mail-data`, AES-GCM 마스터 키는 별도 `mail-keys` 볼륨에 저장됩니다. 두 볼륨을 모두 복구할 수 있어야 합니다. DB는 평문이므로 호스트·백업 저장소의 접근 권한도 보호해야 합니다. 키가 없으면 암호화된 메일·모델 자격정보를 복구할 수 없습니다.

업데이트 전 프로세스를 정지한 상태에서 두 볼륨과 이전 이미지를 백업합니다. 스키마가 바뀐 업데이트를 되돌릴 때에는 이전 이미지와 그 시점의 데이터·키를 함께 복구합니다. SMTP 결과가 불명확한 메일은 원본과 마찬가지로 자동 재발송하지 않으며 보낼 편지함에서 직접 확인합니다.
