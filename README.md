# 베타로그 (BetaLog)

클라이머가 푼 문제를 **사진·영상과 함께 색상(난이도)별로 기록**하는 앱이에요. 더클라임 지점과 색상 체계를 기준으로 만들었어요.

- **내 문제**: 사진에 홀드 순서(베타) 표시, 시도·완등·플래시 기록, 영상 보관
- **리플레이**: 카메라를 켜두면 최근 20~45초만 기억했다가, 버튼을 누르면 그 장면을 클립으로 남겨요. 다른 탭으로 가도 녹화는 계속돼요
- **영상 비교**: 내 시도와 완등자 영상을 같은 속도로 나란히 재생
- **기록**: 주별 최고 난이도, 색상별 완등 수, 플래시 비율
- **타이머**: 행보드 리피터·맥스행·타바타
- **동기화**: 로그인하면 기록이 서버에 저장돼 폰을 바꿔도 이어져요. 서버에 연결이 안 돼도 폰에서 모두 동작하고, 연결되면 자동으로 올라가요(오프라인 우선). 사진·영상은 용량 때문에 폰에만 남아요.

## 설치

| 기기 | 방법 |
|---|---|
| 안드로이드 | [Releases](../../releases/latest)에서 `betalog-x.y.z.apk`를 폰으로 받아 설치해요. '출처를 알 수 없는 앱' 설치를 허용해야 해요. 새 버전도 같은 방법으로 덮어 설치하면 기록이 유지돼요. |
| 아이폰 | 사파리로 웹 버전 `https://<GitHub 아이디>.github.io/betalog-app/`을 열고 공유 → **홈 화면에 추가**. |

## 서버 (무료: Render + Neon)

서버는 로그인과 기록 동기화만 맡아요. **월 0원**으로 운영하는 구성이에요.

- **Render 무료 웹 서비스**: 파이썬(FastAPI) 서버가 돌아가요. 15분 동안 아무도 안 쓰면 잠들고, 다음 접속 때 깨어나는 데 1분쯤 걸려요. 앱은 그동안 폰에 저장해 두었다가 서버가 깨면 알아서 동기화해요.
- **Neon 무료 Postgres**: 기록이 저장되는 DB예요(1GB). Render 무료 DB는 30일 뒤 지워져서 쓰지 않아요.

### 처음 한 번 설정

1. **Neon**: [neon.com](https://neon.com)에 GitHub 계정으로 가입 → 프로젝트 만들기(지역: **AWS Asia Pacific (Singapore)**) → 대시보드의 **Connect**에서 연결 문자열(`postgresql://...`)을 복사해요.
2. **Render**: [render.com](https://render.com)에 GitHub 계정으로 가입 → **New → Blueprint** → 이 저장소 선택 → `DATABASE_URL`에 1번에서 복사한 연결 문자열을 붙여넣고 **Apply**.
   몇 분 뒤 `https://betalog-api-xxxx.onrender.com` 같은 주소가 생겨요. 브라우저에서 `/api/health`를 열어 `"database":"postgres"`가 보이면 성공이에요.
3. **기본 서버 주소 등록** (선택이지만 추천): GitHub 저장소 → Settings → Secrets and variables → Actions → **Variables** → `DEFAULT_SERVER` = 2번의 주소. 그러면 앱 로그인 화면에 서버 주소가 미리 들어가서 지인들이 입력할 필요가 없어요. 등록한 뒤 Actions에서 "Android APK"와 "Web (GitHub Pages)"를 한 번씩 다시 실행하세요.
4. 앱에서 상단 **로그인** → (서버 주소 확인) → **회원가입**. 지인들도 각자 가입하면 돼요.

코드를 GitHub에 올리면 Render가 서버를 자동으로 다시 배포해요.

### 서버 설정 (환경 변수)

| 변수 | 설명 |
|---|---|
| `DATABASE_URL` | Neon 연결 문자열. 비어 있으면 `./data/betalog.db`(SQLite)를 써요 — Render에서는 재시작하면 사라지니 꼭 넣으세요 |
| `JWT_SECRET` | 로그인 토큰 서명 키(32자 이상). Render가 자동으로 만들어요. 바꾸면 모두 다시 로그인해야 해요 |
| `SIGNUP_CODE` | 초대 코드. 정해 두면 이 코드를 아는 사람만 가입할 수 있어요(공개 서버라 꼭 정하길 추천). 친구들에게만 알려 주세요 |
| `CORS_ORIGINS` | 허용할 앱 주소(쉼표로 구분), 기본 `*` |

### 내 PC에서 서버 돌리기 (개발용)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # 윈도우: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080     # http://localhost:8080/api/health
pytest -q                                           # 테스트
```
같은 와이파이의 폰에서는 앱의 서버 주소에 `PC의 IP:8080`(예: `192.168.0.10:8080`)을 넣으면 연결돼요(안드로이드 앱만. 웹 버전은 https 서버만 연결돼요).

## 구조

```
frontend/   React + TypeScript (Vite). Capacitor로 안드로이드 앱(frontend/android)을 만들어요
backend/    Python FastAPI: 로그인(JWT), 동기화 API, SQLAlchemy(Postgres / SQLite)
render.yaml Render 무료 서버 설정
.github/    APK 빌드·릴리스, 웹(GitHub Pages) 배포, 서버 테스트(SQLite·Postgres)
```

### API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 서버 확인 |
| POST | `/api/auth/signup` | `{username, password, displayName}` → `{token, username, displayName}` |
| POST | `/api/auth/login` | `{username, password}` → 같은 응답 |
| GET | `/api/me` | 내 정보 (Bearer 토큰) |
| POST | `/api/sync` | `{since, problems[], attempts[]}` → `{cursor, problems[], attempts[]}` |

동기화 규칙: 폰이 바꾼 행을 올리고, 서버에서 `since` 이후 바뀐 행을 받아요. 같은 행을 두 곳에서 고치면 **나중에 고친 쪽**(`updatedAt`)이 이겨요. 삭제는 `deleted: true`로 전달돼요. 다른 사람의 기록은 바꿀 수 없어요.

## 개발

```bash
cd frontend && npm install && npm run dev        # http://localhost:5173
cd frontend && npm run cap:sync && npx cap open android   # Android Studio로 열기
```

## 앱 서명

APK는 GitHub Secrets의 키로 서명돼요: `KEYSTORE_B64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. **키를 잃어버리면 기존 앱 위에 업데이트할 수 없으니** 키 파일을 안전한 곳에 따로 보관하세요. 키는 저장소에 올리지 않아요.

## 보안

- 비밀번호는 bcrypt로 저장하고, 가입 시 8자 이상이어야 해요.
- 로그인은 계정마다 15분에 10번까지 틀릴 수 있고, 같은 주소에서 가입은 1시간에 5번까지예요.
- 요청은 5MB까지, 기록은 계정당 30,000개까지 받아요.
- 웹 앱은 콘텐츠 보안 정책(CSP)으로 이 사이트의 코드만 실행해요.
- 사진·영상은 서버에 올라가지 않고 각자 폰에만 저장돼요.
- 서명 키(keystore)와 비밀번호는 저장소에 올리지 말고 GitHub Secrets에만 넣으세요.
