# tt 이슈 노트

`tt-demo` 투두 앱을 만들면서 만난 ttc 이슈 정리.

- **환경**: `@openload28/tt-lang` 1.0.0-dev.20260831.300 (ttc), `@openload28/unplugin-tt` 0.1.0-next.1.0.0.20260831.300, TypeScript 7.1.0-dev.20260826.1, Vite 8.2.2, Bun 1.3.11 (linux-x64)
- **날짜**: 2026-09-01

| # | 증상 | 심각도 | 우회 |
|---|------|--------|------|
| 1 | 문(statement) 위치의 단독 `match` → 컴파일러 패닉(ICE) | 빌드 실패 — 에러가 명확해서 발견은 쉬움 | `return match`로 감싸기 |
| 2 | JSX 컨테이너 안 `match` → 앞 형제 요소가 텍스트로 렌더됨 | **조용한 오컴파일** — 에러 없이 잘못된 화면 | match를 JSX 밖으로 빼기 |
| 3 | `result` 블록의 `return [];` → 빈 배열이 문맥 타입을 잃고 `any[]` (ts7005/7034) | strict에서 타입 검사 실패 — 오탐(코드는 건전함) | `[] as readonly T[]`로 단언 |
| 4 | `result` 블록 안의 match 표현식 → 로워링 이중 방출 + 파싱 불가 TS | 빌드 실패 — 자가 검증(verify-failed)이 잡아줌 | match를 블록 밖 헬퍼 함수로 추출 |
| 5 | 블록 arm의 중괄호 없는 `if (c) return v;` → `break`가 if 밖으로 샘 | **조용한 의미 오컴파일** — 유효한 TS라 검증 통과, 런타임에 `undefined` | if 본문에 반드시 중괄호 |
| 6 | result 블록 안에서 값 형태 `try`를 식에 내장(`f(try g() * 1.1)`, `try (파이프라인)`) → ICE 또는 파싱 불가 TS | 빌드 실패 (SourceReordered ICE / verify-failed) | try를 const로 먼저 뽑기 |
| 7 | result 블록을 `\|>` 파이프라인 헤드로 사용 → 성공 `return`이 함수 return으로 방출 | **조용한 의미 오컴파일** — 타입이 우연히 맞으면 무증상 | 파이프 대신 함수 인자/문 위치로 |
| 8 | match 리터럴 arm 값이 반환 문맥 타입을 못 받아 string으로 widen | strict에서 타입 검사 실패 — 오탐(#3과 같은 뿌리) | arm 값에 `as const` |

---

## 1. 문 위치의 단독 `match`가 ICE로 크래시

`match`를 값으로 쓰지 않고 표현식 문(expression statement)으로 쓰면
`validate_source_preservation` 계약 위반으로 컴파일러가 패닉한다.

### 재현

```tt
import * as Result from "@tt/std/result";

const f = (x: number) => {
  match (Result.Ok(x)) {
    Ok(value) => { console.log(value); },
    Err(error) => { console.log(error); },
  };
};
```

```sh
bunx ttc --check src/repro1.tt
```

### 실제 출력

```
error: internal compiler error: validate_source_preservation broke the contract
that every non-whitespace source byte outside tt-owned ranges reaches the target (SourceOmitted)
  at source bytes 79..80
  from source bytes 79..91

  at: src/ice.rs:240:9
  ttc 1.0.0-dev.20260831.300

thread 'main' panicked at src/ice.rs:240:9
```

`79..91` 바이트는 스크루티니 `(Result.Ok(x)` 구간. 실제 앱에서는
`match (parseTodo(draft, todos)) { ... };` (이벤트 핸들러에서 부수효과 분기)에서 발생했다.

### 기대 동작

- 문 위치 match가 지원 대상이면: 정상 컴파일 (문서상 match는 owner-scoped 슬롯으로 로워링되며, 표현식 문은 statement owner가 될 수 있어 보임)
- 지원 대상이 아니면: `match-placement` 같은 위치가 찍힌 진단 — ICE 메시지 스스로도 "This is a bug in ttc, not in the code it was given"이라고 말한다

### 우회

같은 코드를 `return`에 태우면 정상 컴파일된다. 값 대입(`const _ = match ...`)도 동작.

```tt
const f = (x: number) => {
  return match (Result.Ok(x)) {
    Ok(value) => { console.log(value); },
    Err(error) => { console.log(error); },
  };
};
```

적용 위치: `src/App.ttx`의 `addTodo`.

---

## 2. JSX 컨테이너 안 `match` — 앞 형제 요소가 일반 텍스트로 방출됨

`.ttx`에서 JSX 자식 expression container(`{ ... }`)에 `match`를 직접 쓰면,
컴파일러가 평가 순서 보존을 위해 **앞에 있는 형제 JSX 요소들**을 `$tt_vN` 상수로
끌어올린 뒤, 원래 자리에 `{$tt_vN}`(표현식)이 아니라 `$tt_vN`(**JSX 텍스트**)로
되돌려 넣는다. 컴파일 에러가 없고 출력도 유효한 TSX라 자가 검증을 통과하며,
브라우저 화면에 문자 그대로 `$tt_v2 $tt_v3 $tt_v4`가 표시된다.

### 재현

```ttx
return (
  <main className="app">
    <h1>tt todo</h1>
    <p className="tagline">...</p>
    <form className="add" onSubmit={addTodo}>...</form>

    {match (error) {
      Some(value: e) => <p className="error">{describeError(e)}</p>,
      None => null,
    }}
  </main>
);
```

### 실제 컴파일 출력 (`ttc -p`)

```tsx
const $tt_v2 = (<h1>tt todo</h1>);
const $tt_v3 = (<p className="tagline">...</p>);
const $tt_v4 = (<form className="add" onSubmit={addTodo}>...</form>);
{
  const $tt_m = error;
  switch ($tt_m.kind) { /* ... $tt_v1 채움 ... */ }
}
return (
  <main className="app">
    $tt_v2
    $tt_v3

    $tt_v4

    {$tt_v1}
    ...
  </main>
);
```

`$tt_v2`~`$tt_v4`가 중괄호 없이 JSX 텍스트로 들어가 있다. 렌더 결과:

```html
<main class="app">$tt_v2 $tt_v3 $tt_v4<div class="filters">...</div>...</main>
```

h1·입력 폼이 전부 사라지고 슬롯 이름이 화면에 찍힌다.

### 기대 동작

끌어올린 형제 요소는 `{$tt_v2}`처럼 expression container로 복원되어야 한다.
공식 가이드도 "JSX 자식과 속성 expression container 안에서 tt 구문을 사용할 수
있습니다"라고 명시하므로 지원 범위 안의 패턴이다.

참고: match **앞에** 형제 요소가 있을 때만 문제가 된다. 이 케이스가 조용히
깨진다는 점(진단 없음, 빌드 성공)이 ICE보다 위험하다.

### 우회

match를 return 이전에 값으로 계산하고 JSX에는 변수만 넣는다.

```ttx
const errorView = match (error) {
  Some(value: e) => <p className="error">{describeError(e)}</p>,
  None => null,
};

return (
  <main className="app">
    ...
    {errorView}
  </main>
);
```

적용 위치: `src/App.ttx`의 `errorView`.

---

## 3. `result` 블록의 로워링이 빈 배열의 문맥 타입을 잃음

`result` 블록 안 `return value;`는 `const $tt_result = value;`라는 **무주석 중간
상수**를 거쳐 `Ok`로 감싸진다. 손으로 쓴 함수라면 `return [];`의 빈 배열이 반환
타입으로 문맥 추론(contextual typing)되지만, 중간 상수에는 문맥이 없어서 빈 배열이
`any[]`가 되고 strict(noImplicitAny)에서 ts7005/ts7034가 난다. 진단 스스로
"(in code ttc generated for this construct)"라고 표시한다 — 사용자 코드는 건전한데
로워링이 타입 투명(type-transparent)하지 않아 생기는 오탐이다.

### 재현

```tt
import type { TResult } from "@tt/std";
import * as Result from "@tt/std/result";

const g = (): TResult<number, string> => Result.Ok(1);

const f = (): TResult<readonly number[], string> => result {
  const n = try g();
  if (n === 0) return [];   // ← 여기
  return [n];               // 원소가 있으면 number[]로 추론돼 문제 없음
};
```

### 실제 출력

```
error[ts7005]: Variable '$tt_result' implicitly has an 'any[]' type. (in code ttc generated for this construct)
error[ts7034]: Variable '$tt_result' implicitly has type 'any[]' in some locations where its type cannot be determined. (in code ttc generated for this construct)
```

로워링 결과(`ttc -p`):

```ts
const f = (): TResult<readonly number[], string> => {
  let $tt_v0;
  $tt_v0: {
  const $tt_t0 = g(); if (!("value" in $tt_t0)) { $tt_v0 = $tt_t0; break $tt_v0; } const n = $tt_t0.value;
  if (n === 0) { const $tt_result = []; $tt_v0 = { kind: "Ok" as const, value: $tt_result }; break $tt_v0; }
  //                                ^^ 문맥 타입 없음 → any[]
  { const $tt_result = [n]; $tt_v0 = { kind: "Ok" as const, value: $tt_result }; break $tt_v0; }
}
  return $tt_v0;
};
```

### 기대 동작

`return value;`의 value가 원래 자리에서 받았을 문맥 타입을 유지해야 한다
(빈 배열·빈 객체·제네릭 함수 결과 등 문맥 의존 표현식 전반이 영향권).

### 우회

리터럴에 타입을 직접 준다.

```tt
if (raw === null) return [] as readonly Todo[];
```

적용 위치: `src/storage.tt`의 `loadTodos`.

---

## 4. `result` 블록 안의 match 표현식 — 로워링 이중 방출 + 파싱 불가 TS

`result` 블록 본문에서 match를 값으로 쓰면(`return match (...)` 또는
`const x = match (...)`) match의 문(statement) 로워링이 **두 번** 방출된다:
한 번은 올바르게 호이스팅된 사본, 한 번은 원래 표현식 자리에 그대로 붙인
사본. 후자가 `const $tt_result = let $tt_v3;` 같은 파싱 불가능한 TS가 되어
자가 검증이 `verify-failed`로 빌드를 막는다. 두 로워링(result 블록의
`return`/선언 처리와 match의 슬롯 로워링)이 합성되지 않는 케이스.

### 재현

```tt
import type { TResult } from "@tt/std";
import * as Result from "@tt/std/result";

const g = (): TResult<number, string> => Result.Ok(1);

const f = (): TResult<number, string> => result {
  const n = try g();
  const doubled = match (n) {   // return match (...)도 동일
    0 => 0,
    _ => n * 2,
  };
  return doubled;
};
```

### 실제 출력

```
error[verify-failed]: generated TypeScript failed to parse: `let` cannot be used
as an identifier in strict mode. This is either invalid TypeScript passed through
from the source or a ttc bug; use --no-verify to bypass.
```

`--no-verify -p`로 본 생성물(발췌):

```ts
  let $tt_v3;                       // ← 올바르게 호이스팅된 사본
  { const $tt_m = envelope; switch ($tt_m.kind) { ... } }
  const outcome = let $tt_v3;       // ← 같은 로워링이 초기화식 자리에 또 붙음 (invalid)
  { const $tt_m = envelope; switch ($tt_m.kind) { ... } }
```

### 기대 동작

match 로워링이 한 번만, 호이스팅된 형태로 방출되고 원래 자리는 `$tt_v3`
참조로 남아야 한다. (일반 함수 본문의 `const x = match (...)`는 정확히 그렇게
동작한다 — result 블록 안에서만 깨진다.)

### 우회

match를 result 블록 밖의 헬퍼 함수로 추출하고 블록에서는 호출만 한다.

```tt
const outcomeOf = (envelope: Envelope): LoadOutcome =>
  match (envelope) { ... };

export const loadTodos = (): TResult<LoadOutcome, LoadError> => result {
  ...
  return outcomeOf(envelope);
};
```

적용 위치: `src/storage.tt`의 `loadTodos` / `outcomeOf`.

---

## 5. 블록 arm의 중괄호 없는 `if (c) return v;` — `break`가 if 밖으로 샘

**이번 세션에서 가장 위험한 이슈.** match 블록 arm 안의 단문 if는
`return v`가 `$tt_v = v; break;` 두 문장으로 로워링되는데, 이때 중괄호가
없으면 두 번째 문장(`break`)이 if **바깥**에 떨어진다. 결과적으로 조건이
거짓이어도 무조건 arm을 빠져나가고, 슬롯이 미할당이라 match 전체가
`undefined`가 된다. 생성물이 유효한 TS라 자가 검증도 통과한다 — 컴파일도
빌드도 성공하고 런타임 동작만 조용히 틀린다. (유닛 테스트가 잡아냈다.)

### 재현

```tt
variant V { A(n: number), B }

export const f = (v: V): number =>
  match (v) {
    A(n) => {
      if (n === 0) return 100;   // ← 중괄호 없음
      return n;
    },
    B => -1,
  };
// f(V.A(5)) === undefined  (기대: 5)
// f(V.A(0)) === 100        (이 경로만 우연히 정상)
```

### 실제 로워링 (`ttc -p`)

```ts
case "A": { const { n } = $tt_m;
  if (n === 0) $tt_v0 = 100; break;   // ← break가 if 밖: 무조건 실행
  $tt_v0 = n; break; }                //    이 줄엔 절대 도달하지 못함
```

중괄호를 붙이면 올바르다:

```ts
  if (n === 0) { $tt_v1 = 100; break; }   // 정상
  $tt_v1 = n; break;
```

### 기대 동작

단문 if 본문의 `return`을 다문장으로 로워링할 때 블록으로 감싸야 한다.
(가드 로워링은 이미 올바르게 `{ $tt_v = ...; break; }`로 감싼다 — arm 본문
경로만 빠져 있다.)

### 우회

블록 arm 안에서는 if 본문에 **반드시 중괄호**를 쓴다.

```tt
if (!Number.isFinite(days)) { return DueStatus.NoDue; }
```

적용 위치: `src/todo.tt`의 `dueStatusOf`. 같은 이유로 이 저장소의 모든 블록
arm은 중괄호 규칙을 지킨다 (`App.ttx`의 `clearDone`류 일반 함수 본문은
passthrough라 무관).

---

## 6. result 블록 안의 값 형태 `try` 내장 — ICE 또는 파싱 불가 TS

값 형태 try를 result 블록 안에서 **더 큰 식에 내장**하면 깨진다. 두 증상:

**(a) 식 내장 → ICE (SourceReordered).** 일반 함수에서는 정상인 코드가
result 블록에서만 크래시.

```tt
// 일반 함수: 정상
export const ok = (): TResult<number, string> => {
  return Result.Ok(Math.round(try t() * 1.1));
};

// result 블록: ICE
export const bad = (): TResult<number, string> => result {
  return Math.round(try t() * 1.1);
};
```

```
error: internal compiler error: validate_source_preservation broke the contract
that source spans reach the target in source order unless a relocation says
otherwise (SourceReordered)
```

**(b) try (파이프라인) → verify-failed.** 역시 일반 함수에서는 정상.

```tt
export const bad2 = (): TResult<string, string> => result {
  const v = try (t() |> Result.mapP((n: number) => n.toFixed(1)));  // verify-failed
  return v;
};
```

최상위 형태(`const v = try g();`, `return try (cond ? a() : b());`)는
result 블록 안에서도 정상이다 — 내장/합성만 깨진다.

### 우회

result 블록 안에서는 try를 항상 **문장 하나로** 뽑고, 가공은 다음 문장에서.

```tt
const halved = try half(n);
return Math.round(halved * 1.1);
```

적용 위치: `src/lab.tt`의 `computeBudget` / `normalizedBudgetBlock`
(일반 함수 대조군: `computeBudgetFn` / `normalizedBudget`).

---

## 7. result 블록을 파이프라인 헤드로 쓰면 성공 `return`이 함수 return으로 샘

`result { ... } |> step` 형태에서 블록의 성공 `return v;`가 `Ok(v)`로 블록을
완료하는 대신 **바깥 함수의 실제 return으로 그대로 방출**된다. 실패 경로만
파이프에 연결되고, 성공하면 파이프 전체를 건너뛰고 함수가 조기 종료한다.
반환 타입이 우연히 맞으면 아무 진단 없이 틀린 값이 나온다.

### 재현

```tt
export const f = (): number => {
  const total = result {
    const unit = try t();     // Ok(10)
    return unit * 2;
  } |> Result.unwrapOrP(0);
  return total;
};
// 기대: total = 20. 실제: `return unit * 2`가 f의 return으로 방출되어
// 파이프·total 대입에 도달하지 않는다 (스텝이 값을 바꾸면 결과가 달라짐).
```

실제 로워링:

```ts
do {
  $tt_v0: {
    const $tt_t0 = t(); if (!("value" in $tt_t0)) { $tt_v0 = $tt_t0; break $tt_v0; } const unit = $tt_t0.value;
    return unit * 2;                     // ← Ok 래핑 없이 함수 return
  }
  $tt_v0 = Result.unwrapOrP(0)($tt_v0);  // 실패 경로만 여기 도달
  break;
} while (false);
```

함수 **인자 위치**와 **템플릿 보간 위치**(파이프 없이)는 올바르게
`$tt_v = { kind: "Ok", value: ... }`로 로워링된다 — 파이프 헤드 경로만 깨진다.

### 우회

result 블록에 파이프를 붙이지 말고 함수 인자로 감싼다.

```tt
const total = Result.unwrapOr(result { ... }, 0);
```

적용 위치: `src/lab.tt`의 `receiptLine`.

---

## 8. match 리터럴 arm 값이 반환 문맥 타입을 못 받음 (#3과 같은 뿌리)

match 로워링의 슬롯(`let $tt_v;`)이 무주석이라, 리터럴 유니언을 반환하는
함수에서 arm의 문자열 리터럴이 `string`으로 widen되어 ts2322가 난다.
손으로 쓴 switch/return이라면 반환 타입이 문맥으로 좁혀줄 코드다.

### 재현

```tt
export type Toggle = "on" | "off";

export const flip = (t: Toggle): Toggle =>
  match (t) {
    "on" => "off",   // error[ts2322]: expected `Toggle`, found `string`
    "off" => "on",
  };
```

### 우회

arm 값에 `as const`(또는 `as Toggle`)를 붙여 리터럴 타입을 지킨다.

```tt
"on" => "off" as const,
```

적용 위치: `src/lab.tt`의 `flip`.

---

## 문제 없었던 것들

같은 세션에서 아래는 전부 문서대로 동작했다 (2차 확장에서 검증 범위를 크게 넓힘):

- `variant` 선언/생성자, 태그·리터럴 match와 완전성 검사, 필드 이름 바인딩·별칭(`Ok(value: text)`), 서브셋 바인딩(`Err => ...`)
- **튜플 match** — `match (filter, progress)`의 곱 완전성 + 최종 `_`
- **가드** — 같은 태그를 가드 arm이 먼저 가로채는 패턴(`ClearedDone(removed) if removed.length > 1`), 외부 변수 참조 가드
- **or-패턴** — `NoneDone | SomeDone => ...`
- **`is` 패턴** — `is SyntaxError { message }`로 예외 클래스 구분 (최종 `_` 필수 규칙 포함)
- **`try`** — 함수 단위 전파(`decodeTodo`)와 `result` 블록 내부 전파 모두
- **`result` 블록** — concise arrow 본문(`=> result { ... }`)에서 단계별 Err 전파 (이슈 #3의 빈 배열 케이스만 제외)
- **`let-else`** — 발산하는 else(`{ return; }`)와 `Option.fromNullable` 조합
- **`if let`** — `useEffect` 콜백 안에서 `if let Err(error: e) = saveTodos(todos)`
- **`|>` 파이프라인** — 값 파이프, 메서드 스텝, `Result.mapErrP`/`mapP` 커리 스텝 체인
- **`flow`** — 화살표 스텝 합성(`normalize`), 파이프 헤드에서 사용
- **`@tt/std`** — `TResult`/`TOption`, `Result.fromThrowable`, `Result.collect`, `Option.fromNullable`
- **`val`** — 모듈 수준 `val const` 바인딩
- unknown 스크루티니에 대한 리터럴 match(런타임 `===` 분기), 중첩 match(arm 본문 안 match)
- `.tsx` → `.ttx`/`.tt` import, unplugin Vite 통합, `ttc --check-types` 통합 검사

런타임도 브라우저 e2e로 확인: 우선순위 순환·정렬, 되돌리기(모든 Action 역적용),
완료 비우기, localStorage 저장/복원, 손상된 JSON·잘못된 항목의 에러 배너.

3차(엔터프라이즈 케이스) 라운드에서 추가로 확인:

- **중첩 패턴** — `Err(error: FutureVersion)` (제네릭 `TResult`의 error 자리에서
  패턴 증거로 variant를 식별하는 경로)
- **`if let` + `else` 블록** — `useEffect` 콜백과 복구 루프(`salvage`) 안에서
- **`let-else`** — 디코더(`decodeCore`) 안에서 `Option` 언랩
- **map 콜백 블록 안의 match → JSX arm** — 이슈 #2와 달리 형제 요소가 없으면 정상
- **vitest 통합** — `.test.ts`가 `.tt` 모듈과 `@tt/std`를 그대로 import,
  vite 플러그인 경유로 33개 테스트 실행 (이 테스트가 이슈 #5를 잡음)
- 스키마 v1→v2 마이그레이션·부분 복구·미래 버전 보호·용량 초과 분류·멀티탭
  storage 이벤트까지 케이스 매트릭스 전부 유닛 테스트+e2e로 검증

4차(구문 조합) 라운드 — `src/lab.tt`/`src/sync.tt`가 카나리아, 58개 테스트:

- **제네릭 재귀 variant** — `Tree<T>` 재귀 match, 제네릭 필드를 따라가는 중첩 패턴
- **값 형태 try** — 일반 함수의 식 내장(`Result.Ok(Math.round(try f() * 1.1))`),
  괄호 전파(`try (cond ? a() : b())`), `try (파이프라인)` — 모두 일반 함수 한정
  (result 블록 조합은 이슈 #6)
- **result 블록 위치** — match arm 블록 안, 함수 인자, 템플릿 보간(파이프 없이),
  concise arrow 본문 — 파이프 헤드만 이슈 #7
- **파이프라인 옵셔널 스텝** — `profile |> ?.contact |> ...` 단락 후에도 다음
  스텝이 undefined로 이어지는 계약
- **flow + val 조합** — `export val const gradeOf = flow |> ... |> ...`
- **튜플 match + 가드** — 가드 거짓 시 다음 조합 arm으로 낙하
- **리터럴 or-패턴 + 가드** — `429 if retried => ...` / `429 => ...` 공존
- **async 조합** — match 스크루티니의 `await`(루프 안에서 매회 평가), 가드의
  `await`(단락 평가 유지 — None이면 검증 함수가 호출조차 안 됨), arm 본문·
  `if let` 본문의 `await`, `Result.fromPromise` 재시도 상태 머신
- **val 바인딩 → 같은 파일 val 파라미터 전달**, let-else + or-패턴,
  `if let` + 중첩 패턴(`Ok(value: Some(value: v))`)
