# JSP JavaScript Validator

JSP 파일 내부 JavaScript 코드를 정적 분석하여 오류를 검출하는 도구입니다.

## 주요 기능

1. **JSP 스크립트 추출**  
   - `<script>` 태그 내 inline JavaScript 추출
   
2. **의존성 자동 로드** (기본값: 활성화)
  - 공통 레이아웃 `/resources/common/layout.jsp` 기본 선로드
   - `<script src="...">` 외부 JS 파일 로드
   - `<%@ include file="..."%>` JSP include 지시문 처리 및 포함된 JSP의 스크립트 추출
   - 중첩된 include 재귀 처리
   - 순환 참조 방지

3. **정적 분석**
   - ESLint 기반 no-undef 규칙으로 정의되지 않은 함수/변수 검출
   - jQuery(`$`), genexon 등 프레임워크 globals 자동 등록
   - 파싱 에러 발생 시에도 다른 코드 분석 계속 수행

4. **오류 시각화**
   - 모든 오류를 `.annotated.jsp` 파일에 inline 주석으로 표시
   - 원본 코드 라인 기반 정확한 위치 표기

5. **유연한 인터페이스**
   - REST API (localhost:3000)
   - CLI 명령어
   - 프로그래매틱 API

## 설치

```bash
npm install
```

필수 패키지:
- eslint@8.57.1
- express@5.2.1
- node.js 14+

## 실행 방법

### 1. 로컬 서버 실행

```bash
npm start
```

서버는 `http://localhost:3000` 에서 시작됩니다.

서버가 정상 실행되는지 확인:
```bash
curl http://localhost:3000
```

응답 예시:
```json
{
  "status": "running",
  "endpoints": {
    "GET /": "API 정보",
    "GET /health": "헬스 체크",
    "POST /lint/file": "JSP 파일 경로로 검사",
    "POST /lint/content": "JSP 본문 문자열로 검사"
  }
}
```

### 2. CLI로 파일 검사 (권장)

단일 JSP 파일 즉시 검사:

```bash
node src/cli.js <JSP_파일_경로> [--with-deps | --no-deps]
```

예시:
```bash
# 의존성 포함해서 검사 (기본값)
node src/cli.js samples/test.jsp

# 의존성 제외하고 검사
node src/cli.js samples/test.jsp --no-deps

# 의존성만 포함해서 검사
node src/cli.js samples/test.jsp --with-deps
```

결과:
- 터미널에 JSON 형식 출력
- 오류가 있으면 `<파일명>.annotated.jsp` 생성
- 의존성 로드 상황 보고 (loaded/skipped/missing)

## REST API 사용법

### GET /

서버 상태와 사용 가능한 엔드포인트 확인

```bash
curl http://localhost:3000
```

### GET /health

헬스 체크

```bash
curl http://localhost:3000/health
```

### POST /lint/file

JSP 파일 경로로 검사

요청:
```bash
curl -X POST http://localhost:3000/lint/file \
  -H "Content-Type: application/json" \
  -d '{
    "jspPath": "samples/test.jsp",
    "withDependencies": true,
    "writeAnnotatedFile": true
  }'
```

요청 파라미터:
- `jspPath` (필수): JSP 파일 상대 경로
- `withDependencies` (선택, 기본값: true): `<script src>` 및 `<%@ include>` 로드 여부
- `writeAnnotatedFile` (선택, 기본값: true): `.annotated.jsp` 파일 생성 여부

응답 예시:
```json
{
  "file": "/absolute/path/to/test.jsp",
  "scriptCount": 2,
  "withDependencies": true,
  "dependencyReport": {
    "loaded": [
      {
        "src": "/resources/common/jstl-tld.jsp",
        "file": "/absolute/path/samples/resources/common/jstl-tld.jsp"
      }
    ],
    "skipped": [],
    "missing": []
  },
  "annotatedFile": "/absolute/path/samples/test.annotated.jsp",
  "ok": false,
  "totalIssues": 13,
  "details": [...]
}
```

### POST /lint/content

JSP 본문 문자열로 검사

요청:
```bash
curl -X POST http://localhost:3000/lint/content \
  -H "Content-Type: application/json" \
  -d '{
    "jspContent": "<script>const x = ; console.log(x);</script>",
    "includeAnnotatedContent": true
  }'
```

요청 파라미터:
- `jspContent` (필수): JSP HTML 문자열
- `includeAnnotatedContent` (선택): 응답에 `annotatedContent` 포함 여부

응답:
```json
{
  "ok": false,
  "scriptCount": 1,
  "totalIssues": 1,
  "annotatedContent": "...",
  "details": [...]
}
```

## npm 스크립트

프리셋 검사 명령어:

```bash
# 기본 샘플 검사 (inline 스크립트만)
npm run check:sample

# 의존성 포함 샘플 검사
npm run check:deps-sample

# 의존성 제외 검사 (비교용)
npm run check:deps-sample:no-deps

# 개발 서버 실행 (nodemon으로 자동 재시작)
npm start
```

## 설정

### ESLint 규칙

기본 설정 (`src/linter.js`):

```javascript
extends: ["eslint:recommended"],
env: { browser: true, es2022: true },
rules: { "no-undef": "error" }
```

**등록된 Globals** (false positive 제거):
- `$` (jQuery)
- `genexon` (custom framework)
- `kendo` (Kendo UI)
- `jQuery`, `channelTypeChange`, `excelPopOpen`, `resizeGrid` 등

### 의존성 해석

**JSP include 지시문** (`<%@ include file="..."%>`):
- 상대 경로로 해석 (현재 JSP 파일 기준)
- 절대 경로 (`/`로 시작)는 프로젝트 루트 기준으로 변환
- 포함된 JSP의 모든 `<script>` 블록 추출
- 중첩된 include 자동 재귀 처리

**외부 JS 파일** (`<script src="...">`):
- 로컬 파일만 로드 (http://, // 프로토콜 제외)
- JSP EL 표현식 (`${...}`, `<%...%>`) 포함 경로는 skip

## 출력 파일

오류 발견 시 생성되는 파일:

```
samples/test.annotated.jsp
```

형식: HTML 주석으로 오류 정보 추가

```html
<!-- [JS ERROR] col 5: 'genexon' is not defined., rule: no-undef -->
genexon.initKendoUI_ddl($srch_scd);
```

## 프로젝트 구조

```
js-validator/
├── src/
│   ├── cli.js              # CLI 엔트리포인트
│   ├── server.js           # Express 서버 (localhost:3000)
│   ├── extractor.js        # JSP에서 JS 추출
│   ├── dependencies.js     # 외부 파일/include 로드
│   ├── linter.js           # ESLint 실행 및 분석
│   └── annotator.js        # .annotated.jsp 파일 생성
├── samples/
│   ├── test.jsp            # 테스트 샘플
│   ├── sample.jsp          # 기본 샘플
│   └── resources/common/   # include 샘플 파일
├── package.json
└── README.md
```

## 사용 예제

### 예제 1: 로컬 서버로 검사

```bash
# 1. 서버 시작
npm start

# 2. 다른 터미널에서 curl로 요청
curl -X POST http://localhost:3000/lint/file \
  -H "Content-Type: application/json" \
  -d '{"jspPath": "samples/test.jsp"}'
```

### 예제 2: CLI로 직접 검사

```bash
# 기본 검사 (의존성 포함)
node src/cli.js samples/test.jsp

# 결과: 터미널에 JSON 출력 + samples/test.annotated.jsp 생성
```

출력 예시:
```json
{
  "file": "C:\\js-validator\\samples\\test.jsp",
  "scriptCount": 2,
  "withDependencies": true,
  "dependencyReport": {
    "loaded": [
      {
        "src": "/resources/common/jstl-tld.jsp",
        "file": "C:\\js-validator\\samples\\resources\\common\\jstl-tld.jsp"
      }
    ],
    "skipped": [],
    "missing": []
  },
  "annotatedFile": "C:\\js-validator\\samples\\test.annotated.jsp",
  "ok": false,
  "totalIssues": 13,
  "details": [...]
}
```

### 예제 3: 의존성 포함 여부 비교

```bash
# 의존성 포함 (기본값)
node src/cli.js samples/test.jsp --with-deps
# 결과: 109 → 13 이슈 감소 (genexon 등이 정의됨)

# 의존성 제외
node src/cli.js samples/test.jsp --no-deps
# 결과: genexon, channelTypeChange 등이 미정의로 표시됨
```

## 검출되는 오류 유형

| 오류 유형 | 예시 | 규칙 |
|---------|------|------|
| 미정의 함수 | `srch()` (정의 없음) | no-undef |
| 미정의 변수 | `undefined_var` 사용 | no-undef |
| 파싱 에러 | `const x = ;` | Parse error |
| 미사용 변수 | `var x = 5;` (사용 안 함) | warning (`no-unused-vars`) |

**주의**: 객체 메서드 오타(예: `obj.prop1()` vs `obj.prop()`)는 현재 타입 정보 부재로 검출 안 됨.

## 문제 해결

### 1. include 파일이 로드되지 않음

**증상**: `dependencyReport.missing` 에 파일이 나타남

**해결책**:
- 경로가 프로젝트 루트 기준으로 올바른지 확인
- 상대 경로는 현재 JSP 파일 기준 (예: `../common/header.jsp`)
- 절대 경로는 `/`로 시작하고 프로젝트 루트 기준 (예: `/resources/common/jstl-tld.jsp`)

### 2. genexon 등이 여전히 미정의로 표시됨

**증상**: `'genexon' is not defined` 오류

**원인**: 
- `--no-deps` 플래그 사용 중
- include 파일에서 genexon이 정의되지 않음

**해결책**:
```bash
# 의존성 포함해서 실행
node src/cli.js <파일> --with-deps

# 또는 include 경로 확인
```

### 3. 파싱 에러로 인해 다른 오류가 안 보임

**증상**: 일부 코드 블록에서 오류가 검출되지 않음

**원인**: 해당 블록에 문법 오류가 있으면 파싱 실패

**현재 동작**: 파싱 실패한 블록은 제외하고 다른 블록은 계속 분석

**해결책**: 먼저 파싱 에러 수정 후 재검사

## 라이선스

MIT
