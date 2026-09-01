import { beforeEach, describe, expect, it } from "vitest";
import type { TResult } from "@tt/std";
import * as Option from "@tt/std/option";

import { Priority, type Todo } from "./todo.tt";
import {
  LEGACY_KEY,
  LoadError,
  STORAGE_KEY,
  SaveError,
  loadTodos,
  saveTodos,
} from "./storage.tt";

const unwrap = <T, E>(result: TResult<T, E>): T => {
  if ("value" in result) return result.value;
  throw new Error(`expected Ok, got ${JSON.stringify(result)}`);
};

const unwrapErr = <T, E>(result: TResult<T, E>): E => {
  if ("value" in result) throw new Error("expected Err, got Ok");
  return result.error;
};

/** 테스트용 localStorage — 케이스별로 실패를 주입할 수 있습니다. */
let store: Map<string, string>;
let failGet: boolean;
let failSetWith: (() => Error) | null;

beforeEach(() => {
  store = new Map();
  failGet = false;
  failSetWith = null;
  globalThis.localStorage = {
    getItem: (key: string) => {
      if (failGet) throw new Error("access denied");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (failSetWith !== null) throw failSetWith();
      store.set(key, value);
    },
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
});

const v2 = (todos: readonly unknown[], version = 2) =>
  JSON.stringify({ version, todos });

const storedItem = (over: Record<string, unknown> = {}) => ({
  id: 1,
  text: "장보기",
  done: false,
  priority: "medium",
  due: null,
  ...over,
});

describe("loadTodos — 로드 케이스 매트릭스", () => {
  it("저장된 것이 없으면 빈 목록, 알림 없음", () => {
    const outcome = unwrap(loadTodos());
    expect(outcome.todos).toEqual([]);
    expect(outcome.skipped).toBe(0);
    expect(outcome.migratedFrom).toEqual(Option.None);
  });

  it("v1(맨몸 배열, due 없음)은 자동 이전되고 migratedFrom=Some(1)", () => {
    store.set(
      LEGACY_KEY,
      JSON.stringify([{ id: 1, text: "장보기", done: true, priority: "high" }]),
    );
    const outcome = unwrap(loadTodos());
    expect(outcome.migratedFrom).toEqual(Option.Some(1));
    expect(outcome.todos).toEqual([
      {
        id: 1,
        text: "장보기",
        done: true,
        priority: Priority.High,
        due: Option.None,
      },
    ]);
  });

  it("v2 저장 → 로드 왕복이 무손실", () => {
    const todos: readonly Todo[] = [
      {
        id: 7,
        text: "보고서",
        done: false,
        priority: Priority.High,
        due: Option.Some("2026-09-03"),
      },
    ];
    unwrap(saveTodos(todos));
    expect(unwrap(loadTodos()).todos).toEqual(todos);
  });

  it("미래 버전은 FutureVersion으로 거부 — 데이터를 지키기 위해", () => {
    store.set(STORAGE_KEY, v2([], 3));
    expect(unwrapErr(loadTodos())).toEqual(LoadError.FutureVersion(3));
  });

  it("알 수 없는 과거 버전(v0)은 Malformed", () => {
    store.set(STORAGE_KEY, v2([], 0));
    expect(unwrapErr(loadTodos())).toEqual(
      LoadError.Malformed("알 수 없는 버전 v0"),
    );
  });

  it("JSON이 아니면 Malformed(파서 메시지 포함)", () => {
    store.set(STORAGE_KEY, "{깨진 json");
    const error = unwrapErr(loadTodos());
    expect(error.kind).toBe("Malformed");
  });

  it("version 없는 객체·todos가 배열이 아닌 경우도 Malformed", () => {
    store.set(STORAGE_KEY, JSON.stringify({ todos: [] }));
    expect(unwrapErr(loadTodos()).kind).toBe("Malformed");
    store.set(STORAGE_KEY, JSON.stringify({ version: 2, todos: "x" }));
    expect(unwrapErr(loadTodos()).kind).toBe("Malformed");
  });

  it("일부 항목만 손상되면 그것만 제외하고 skipped로 보고 (부분 복구)", () => {
    store.set(
      STORAGE_KEY,
      v2([
        storedItem(),
        storedItem({ id: 2, priority: "심각" }),
        storedItem({ id: 3, due: 123 }),
        "not-an-object",
        storedItem({ id: 4, text: "코드 리뷰" }),
      ]),
    );
    const outcome = unwrap(loadTodos());
    expect(outcome.todos.map((t) => t.id)).toEqual([1, 4]);
    expect(outcome.skipped).toBe(3);
  });

  it("저장소 접근 자체가 예외를 던지면 Unavailable", () => {
    failGet = true;
    expect(unwrapErr(loadTodos())).toEqual(LoadError.Unavailable);
  });
});

describe("saveTodos — 저장 실패 케이스", () => {
  it("용량 초과(DOMException QuotaExceededError)는 QuotaExceeded", () => {
    failSetWith = () =>
      new DOMException("quota", "QuotaExceededError");
    expect(unwrapErr(saveTodos([]))).toEqual(SaveError.QuotaExceeded);
  });

  it("그 밖의 예외는 Unavailable", () => {
    failSetWith = () => new Error("blocked");
    expect(unwrapErr(saveTodos([]))).toEqual(SaveError.Unavailable);
  });

  it("성공 시 v2 envelope 형태로 기록", () => {
    unwrap(saveTodos([]));
    expect(JSON.parse(store.get(STORAGE_KEY)!)).toEqual({
      version: 2,
      todos: [],
    });
  });
});
