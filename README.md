# JSP JavaScript Validator

JSP 파일에 내장된 JavaScript 코드의 정적 분석 및 오류 검출 도구입니다. 
레거시 JSP 환경에서 JavaScript 문법 오류, 정의되지 않은 변수/함수 사용, jQuery 메서드 오류를 자동으로 감지합니다.

---

## 📋 목차

- [주요 기능](#주요-기능)
- [워크플로우](#워크플로우)
- [아키텍처](#아키텍처)
- [설치 및 설정](#설치-및-설정)
- [사용 방법](#사용-방법)
- [API 레퍼런스](#api-레퍼런스)
- [프로젝트 구조](#프로젝트-구조)
- [의존성 해석](#의존성-해석)
- [글로벌 함수/변수 등록](#글로벌-함수변수-등록)

---

## 🎯 주요 기능

### 1. JavaScript 추출
- JSP 파일 내 `<script>` 태그의 inline JavaScript 자동 추출
- JSP 스크립틀릿(`<%...%>`), 표현식(`<%=...%>`) 제거
- 라인 수 정확도 유지 (오류 위치 추적)

### 2. 의존성 자동 로드 (기본값: 활성화)
- **공통 레이아웃 선로드**: `/resources/common/layout.jsp` 기본 포함
- **외부 JS 파일 로드**: `<script src="...">` 참조 파일 로드
- **JSP Include 처리**: `<%@ include file="..."%>` 지시문 재귀 처리
- **순환 참조 방지**: 동일 파일 중복 로드 차단
- **중첩 로드 지원**: include된 파일 내의 script src, include도 자동 처리

### 3. 정적 분석
- **ESLint 기반**: no-undef, no-unused-vars, no-unused-expressions 규칙
- **프레임워크 글로벌 자동 등록**: jQuery(`$`), genexon 등
- **타입체크**: TypeScript 기반 jQuery 메서드 오류 감지
- **부분 파싱 실패 허용**: 한 코드 블록 오류가 다른 블록 분석을 중단하지 않음

### 4. 오류 시각화
- **주석 기반 표시**: 오류 발생 라인에 HTML 주석으로 표시
- **정확한 위치 추적**: 원본 JSP 라인 번호 기반 매핑
- **여러 소스 추적**: inline script, include file, 외부 JS 파일 모두 출처 기록

### 5. 유연한 인터페이스
- **CLI**: 즉시 사용 가능한 명령어
- **REST API**: 서버 모드로 지속 실행
- **프로그래매틱**: Node.js 모듈로 직접 사용

---

## 🔄 워크플로우

```
사용자 입력 (JSP 파일 또는 내용)
    ↓
┌─────────────────────────────────────┐
│   1. JSP 파싱                        │
│   - <script> 태그 추출               │
│   - JSP 스크립틀릿 제거              │
│   - 라인 번호 기록                   │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│   2. 의존성 로드 (옵션)               │
│   - layout.jsp 선로드                │
│   - <script src> 외부 파일           │
│   - <%@ include> 재귀                │
│   - 중복/순환 제거                   │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│   3. 코드 병합                       │
│   - 모든 코드 블록 순차적 연결       │
│   - 라인 매핑 유지                   │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│   4. ESLint 정적 분석                │
│   - no-undef (미정의 식별자)         │
│   - no-unused-vars (미사용 변수)     │
│   - no-unused-expressions (무의미)   │
│   - 파싱 오류 처리                   │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│   5. 타입체크 (선택)                 │
│   - jQuery 메서드 검증               │
│   - 오타 감지                        │
│   - TypeScript 진단                  │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│   6. 결과 생성                       │
│   - JSON 출력 (CLI)                  │
│   - .annotated.jsp 생성              │
│   - 오류 분류 및 정리                │
└─────────────────────────────────────┘
```

---

## 🏗️ 아키텍처

### 시스템 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│                  JSP JavaScript Validator                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Interface Layer                         │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  CLI        │  REST API      │  Programmatic        │  │
│  │ (cli.js)    │  (server.js)   │  (lintExtracted...) │  │
│  └──────────────────────────────────────────────────────┘  │
│                         ↓                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Core Pipeline Layer                    │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  Extraction   Dependency   Linting   Annotation    │  │
│  │  (extractor) (dependencies) (linter)  (annotator)  │  │
│  └──────────────────────────────────────────────────────┘  │
│                         ↓                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │             Analysis Engines                        │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  ESLint      │  TypeScript  │  llama.cpp (optional)│  │
│  │  (linter)    │  (typecheck) │  (llama)             │  │
│  └──────────────────────────────────────────────────────┘  │
│                         ↓                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Output Layer                           │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  JSON Report  │  Annotated JSP  │  Error Details   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 모듈 구성

| 모듈 | 파일 | 역할 |
|------|------|------|
| **CLI** | `src/cli.js` | 명령어 라인 인터페이스, 옵션 처리 |
| **서버** | `src/server.js` | Express REST API 엔드포인트 |
| **추출기** | `src/extractor.js` | JSP에서 JS 코드 블록 추출 |
| **의존성 로더** | `src/dependencies.js` | 외부 JS, include 파일 로드 및 병합 |
| **린터** | `src/linter.js` | ESLint 설정 및 실행 |
| **타입체크** | `src/typecheck.js` | TypeScript 기반 jQuery 메서드 검증 |
| **LLM** | `src/llama.js` | llama.cpp 연동 (선택) |
| **주석기** | `src/annotator.js` | 오류 주석 기반 JSP 파일 생성 |

### 데이터 흐름

```
JSP File
   ↓
[Extractor] → snippets (inline JS 추출)
   ↓                       ↓
   └─ startLineInJsp        metadata (라인, 소스타입)
   
[Dependencies Loader] → 의존성 코드
   ├─ layout.jsp (기본)
   ├─ <script src>
   ├─ <%@ include>
   └─ (재귀적 로드)

[Combined Snippets] → 단일 코드 문자열
   ↓ (라인 매핑 유지)

[ESLint Linter] → ESLint Messages
   ├─ no-undef
   ├─ no-unused-vars
   └─ no-unused-expressions

[TypeScript Checker] → jQuery Issues
   ├─ 메서드 오타
   └─ 존재 없는 프로퍼티

[Result Mapping] → 원본 위치로 변환
   ├─ jspLine (JSP 파일 라인)
   ├─ sourceFile (발생 파일)
   └─ sourceLine (소스 파일 라인)

[Annotator] → .annotated.jsp
   └─ HTML 주석으로 오류 표시
```

---

## 📦 설치 및 설정

### 요구사항
- Node.js 14+
- npm 또는 yarn

### 설치
```bash
git clone <repository>
cd js-validator
npm install
```

### 필수 패키지
```json
{
  "eslint": "^8.57.1",
  "express": "^5.2.1",
  "typescript": "^5.9.3",
  "@types/jquery": "^3.5.33"
}
```

### ESLint 설정
파일: `src/linter.js`

```javascript
const DEFAULT_GLOBALS = {
  $: "readonly",
  genexon: "readonly",
  gx: "readonly",
  // ... 기타 프레임워크 전역
};

rules: {
  "no-undef": "error",
  "no-unused-vars": "warn",
  "no-unused-expressions": "error"
}
```

### 공통 레이아웃 및 글로벌 설정
- **레이아웃**: `samples/resources/common/layout.jsp`
- **공통 함수**: `samples/resources/common/jstl-tld.jsp`
- **프레임워크**: `samples/resources/common/genexon.js`

---

## 🚀 사용 방법

### 1. CLI 사용 (권장)

#### 기본 검사
```bash
node src/cli.js samples/test.jsp
```

#### 의존성 제외
```bash
node src/cli.js samples/test.jsp --no-deps
```

#### llama.cpp 연동
```bash
node src/cli.js samples/test.jsp --llama \
  --llama-url http://localhost:8080 \
  --llama-model mistral
```

### 2. REST API 사용

#### 서버 시작
```bash
npm start
```

#### 파일 검사 (POST /lint/file)
```bash
curl -X POST http://localhost:3000/lint/file \
  -H "Content-Type: application/json" \
  -d '{
    "jspPath": "samples/test.jsp",
    "withDependencies": true,
    "writeAnnotatedFile": true
  }'
```

#### 내용 검사 (POST /lint/content)
```bash
curl -X POST http://localhost:3000/lint/content \
  -H "Content-Type: application/json" \
  -d '{
    "jspContent": "<script>var x = undefined_var;</script>",
    "includeAnnotatedContent": true
  }'
```

#### 헬스 체크 (GET /health)
```bash
curl http://localhost:3000/health
```

### 3. npm 스크립트

```bash
# 기본 샘플 검사
npm run check:sample

# 의존성 포함 샘플 검사
npm run check:deps-sample

# 의존성 제외 검사
npm run check:deps-sample:no-deps

# 개발 서버 (nodemon 자동 재시작)
npm start
```

---

## 📡 API 레퍼런스

### CLI 옵션

```bash
node src/cli.js <jsp-file-path> [options]
```

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `--with-deps` | flag | true | 의존성 로드 활성화 |
| `--no-deps` | flag | false | 의존성 로드 비활성화 |
| `--llama` | flag | false | llama.cpp 분석 활성화 |
| `--llama-url` | string | `http://127.0.0.1:8080` | llama.cpp 서버 URL |
| `--llama-model` | string | auto-detect | llama 모델명 |
| `--llama-timeout` | number | 600000 | llama 타임아웃 (ms) |

### REST API 엔드포인트

#### GET /
서버 정보 및 사용 가능한 엔드포인트 조회

**응답:**
```json
{
  "ok": true,
  "message": "JSP JS validator server is running",
  "endpoints": {
    "health": "GET /health",
    "lintContent": "POST /lint/content",
    "lintFile": "POST /lint/file"
  }
}
```

#### GET /health
서버 헬스 체크

**응답:**
```json
{ "ok": true }
```

#### POST /lint/file
파일 경로를 기반으로 검사

**요청 본문:**
```json
{
  "jspPath": "samples/test.jsp",
  "withDependencies": true,
  "writeAnnotatedFile": true
}
```

**응답:**
```json
{
  "file": "/absolute/path/to/test.jsp",
  "scriptCount": 2,
  "withDependencies": true,
  "engine": "eslint",
  "dependencyReport": {
    "loaded": [
      { "src": "/resources/common/layout.jsp", "file": "..." },
      { "src": "/resources/common/genexon.js", "file": "..." }
    ],
    "skipped": [],
    "missing": []
  },
  "annotatedFile": "/absolute/path/to/test.annotated.jsp",
  "ok": false,
  "totalIssues": 15,
  "details": [
    {
      "snippetId": 1,
      "startLineInJsp": 13,
      "sourceType": "jsp-inline",
      "sourceFile": "/absolute/path/to/test.jsp",
      "messages": [
        {
          "ruleId": "no-undef",
          "severity": "error",
          "message": "'undefinedFunc' is not defined.",
          "sourceLine": 15,
          "jspLine": 15,
          "sourceColumn": 5,
          "jspColumn": 5
        }
      ]
    }
  ]
}
```

#### POST /lint/content
JSP 내용 문자열로 검사

**요청 본문:**
```json
{
  "jspContent": "<script>var x = y;</script>",
  "includeAnnotatedContent": true
}
```

**응답:**
```json
{
  "ok": false,
  "scriptCount": 1,
  "totalIssues": 1,
  "annotatedContent": "<!-- [JS ERROR] col 10: 'y' is not defined., rule: no-undef -->\nvar x = y;",
  "details": [...]
}
```

---

## 📁 프로젝트 구조

```
js-validator/
├── src/
│   ├── cli.js              # CLI 엔트리포인트
│   ├── server.js           # Express 서버
│   ├── extractor.js        # JSP → JS 추출
│   ├── dependencies.js     # 외부 파일/include 로드
│   ├── linter.js           # ESLint 설정 및 실행
│   ├── typecheck.js        # TypeScript 타입 검사
│   ├── llama.js            # llama.cpp 연동
│   └── annotator.js        # .annotated.jsp 생성
│
├── samples/
│   ├── test.jsp            # 테스트 샘플
│   ├── sample.jsp          # 기본 샘플
│   ├── sample-with-deps.jsp # 의존성 포함 샘플
│   ├── resources/common/
│   │   ├── layout.jsp      # 기본 레이아웃
│   │   ├── jstl-tld.jsp    # 공통 함수
│   │   └── genexon.js      # 프레임워크 객체
│   └── deps/
│       └── broken-lib.js   # 의존성 라이브러리 예시
│
├── tmp/
│   └── typecheck/          # TypeScript 타입체크 임시 파일
│
├── package.json
├── README.md               # 이 파일
└── .gitignore

```

---

## 🔗 의존성 해석

### 의존성 로드 순서

1. **기본 레이아웃** → `/resources/common/layout.jsp`
2. **레이아웃의 script src** → `<script src="/resources/common/genexon.js">` 등
3. **레이아웃의 include** → 레이아웃 내 `<%@ include file="..." %>`
4. **대상 JSP의 script src** → `<script src="...">` 참조 파일
5. **대상 JSP의 include** → `<%@ include file="..." %>` 지시문
6. **대상 JSP의 inline script** → `<script>...</script>` 내용

### 경로 해석 규칙

| 패턴 | 기준점 | 예시 |
|------|--------|------|
| `/absolute/path` | 대상 JSP 디렉터리 | `/resources/common/layout.jsp` |
| `./relative/path` | 현재 JSP 디렉터리 | `./utils.js` |
| `../parent/path` | 상위 디렉터리 | `../shared/common.js` |

### 로드 제외 조건

- **원격 URL**: `http://`, `https://`, `//` 프로토콜
- **동적 경로**: JSP EL (`${...}`) 또는 스크립틀릿 (`<%...%>`) 포함
- **순환 참조**: 이미 로드된 파일
- **파일 부재**: 물리 파일 없음 (missing 리포트)

---

## 📝 글로벌 함수/변수 등록

### 기본 글로벌

[src/linter.js](src/linter.js)에서 설정:

```javascript
const DEFAULT_GLOBALS = {
  $: "readonly",              // jQuery
  genexon: "readonly",        // 사내 프레임워크
  gx: "readonly",             // genexon 별칭
  // ... 기타
};
```

### 공통 함수 정의

**위치**: `samples/resources/common/`

- `layout.jsp`: 레이아웃 기본 함수
  - `channelTypeChange()`: 채널 타입 변경 핸들러
  
- `jstl-tld.jsp`: JSP 유틸 함수
  - `excelPopOpen()`: 엑셀 업로드 팝업
  - `resizeGrid()`: 그리드 리사이징
  
- `genexon.js`: 사내 프레임워크 객체
  - `genexon()`: 생성자 함수
  - `genexon.alert()`: 알림 표시
  - `genexon.excelDown()`: 엑셀 다운로드
  - `genexon.nvl()`: Null 체크 (Java NVL 동치)
  - 외 10+ 메서드

### 새 글로벌 추가 방법

1. **코드 내 선언**
   ```javascript
   var myGlobal = ...;  // 코드에서 선언
   ```

2. **ESLint globals 설정** (`src/linter.js`)
   ```javascript
   globals: {
     myGlobal: "readonly"
   }
   ```

3. **공통 include 파일** (자동 로드)
   ```jsp
   <%@ include file="/resources/common/myCommon.jsp" %>
   ```

---

## 🐛 오류 처리

### ESLint 규칙

| 규칙 | 심각도 | 설명 |
|------|--------|------|
| `no-undef` | error | 정의되지 않은 식별자 사용 |
| `no-unused-vars` | warn | 미사용 변수 선언 |
| `no-unused-expressions` | error | 의미 없는 표현식 (예: `;1`) |

### 타입체크 규칙

| 카테고리 | 예시 | 감지 |
|---------|------|------|
| jQuery 메서드 | `$(...).unknownMethod()` | ✓ |
| 존재 없는 프로퍼티 | `element.notExistProp` | ✓ |
| 타입 불일치 | `$.ajax("string")` | ✓ (타입) |

### 부분 실패 처리

한 코드 블록의 파싱 오류가 다른 블록을 중단하지 않음:

```javascript
// Block 1: 파싱 성공 → 분석 수행
$.ajax(...);

// Block 2: 파싱 실패 → 스킵, Block 3 계속 진행
var broken = ;

// Block 3: 파싱 성공 → 분석 수행
genexon.alert(...);
```

---

## 🔧 고급 설정

### 커스텀 ESLint 규칙 추가

[src/linter.js](src/linter.js)의 `rules` 객체 수정:

```javascript
rules: {
  "no-undef": "error",
  "no-unused-vars": "warn",
  "no-console": "warn",           // 콘솔 사용 경고
  "prefer-const": "warn",         // const 권장
  "semi": ["error", "always"],    // 세미콜론 필수
  // ... 기타
}
```

### llama.cpp 연동

```bash
node src/cli.js samples/test.jsp --llama \
  --llama-url http://localhost:8080 \
  --llama-model mistral-7b
```

llama.cpp는 ESLint보다 높은 수준의 의미 분석이 가능하지만, 결정성이 낮고 느릴 수 있습니다.

---

## 📊 출력 예시

### JSON 결과

```json
{
  "file": "/path/to/test.jsp",
  "scriptCount": 2,
  "withDependencies": true,
  "engine": "eslint",
  "totalIssues": 3,
  "ok": false,
  "details": [
    {
      "snippetId": 1,
      "sourceType": "jsp-inline",
      "sourceFile": "/path/to/test.jsp",
      "startLineInJsp": 13,
      "messages": [
        {
          "ruleId": "no-undef",
          "severity": "error",
          "message": "'undefinedFunc' is not defined.",
          "sourceLine": 15,
          "jspLine": 15
        }
      ]
    }
  ]
}
```

### Annotated JSP 파일

```jsp
<script>
  // 조회
  $('#search').bind('click', function(e) {
    <!-- [JS ERROR] col 5: 'srch' is not defined., rule: no-undef -->
    srch();
  });
</script>
```

---

## 🤝 기여 및 피드백

버그 보고, 기능 제안, 풀 리퀘스트는 언제든 환영합니다.

---

## 📄 라이선스

ISC

---

## 🔗 참고 자료

- [ESLint 문서](https://eslint.org/)
- [TypeScript 문서](https://www.typescriptlang.org/)
- [Express.js](https://expressjs.com/)
- [jQuery API](https://api.jquery.com/)
